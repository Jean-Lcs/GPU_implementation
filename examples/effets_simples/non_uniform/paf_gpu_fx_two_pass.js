import {WebGLContext} from 'webgl'
import {Texture, Matrix} from 'evg'


//metadata
filter.set_name("GLFX");
filter.set_desc("WebGL Effects for video");
filter.set_version("0.1beta");
filter.set_author("GPAC team");
filter.set_help("This filter provides some GPU-based video video effects");

//desscirbe that we accept raw video input and produce raw video output
filter.set_cap({id: "StreamType", value: "Video", inout: true} );
filter.set_cap({id: "CodecID", value: "raw", inout: true} );

//set filter options
filter.set_arg({ name: "depth", desc: "output depth rather than color", type: GF_PROP_BOOL, def: "false"} );

//by default we don't draw on primary framebuffer object (so we will use an intermediate FBO as an output buffer)
//if changing this to true, you must make sure the video output filter is loaded before the WebGL context, ie:
//gpac vout:SID=1 -i source script_gl.js:FID=1
let use_primary = false;

//width and height of output buffer - will be changed at each PID reconfiguration
let width=600;
let height=400;
//input PID (packet source)
let ipid=null;
//output PID (filter output buffers)
let opid=null;

let pix_fmt = '';
let program_pass1 = null;
let program_pass2 = null;

//WebGL context
let gl = null;
//texture created to handle input packet
let pck_tx = null;

//we will use an offscreen buffer for rendering our first pass
let fbo = null;
let off_tx = null;
let fbo_width;
let fbo_height;

//webgl buffers
let buffers = null;

//used for animation counter/timer
let nb_frames=0;

let scaler = 10;

filter.initialize = function()
{
  //create webgl context upon startup
  gl = new WebGLContext(width, height, {depth: filter.depth ? "texture" : true, primary: use_primary});
  //create texture for input packets, with no associated data yet
  pck_tx = gl.createTexture('vidTx');
  pck_tx.pbo = false;
  //load buffers to GPU
  buffers = initBuffersRect(gl);

  //create an fbo
  fbo = gl.createFramebuffer();
  off_tx = gl.createTexture();

}

filter.configure_pid = function(pid) 
{
  //new input PID is declared, create an output pid
  if (!opid) {
    opid = this.new_pid();
  }
  ipid = pid;
  opid.copy_props(pid);
  opid.set_prop('PixelFormat', 'rgba');
  opid.set_prop('Stride', null);
  opid.set_prop('StrideUV', null);
  let n_width = pid.get_prop('Width');
  let n_height = pid.get_prop('Height');
  let pf = pid.get_prop('PixelFormat');
  //change of size, resize webGL
  if ((n_width != width) || (n_height != height)) {
    width = n_width;
    height = n_height;
    gl.resize(width, height);
  }
  //change of input pixek format, reconfigure associated texture
  if (pf != pix_fmt) {
    pix_fmt = pf;
    //we delete the GLSL program info so that it will be recomputed upon mloading the next input packets
    program_pass1 = null;
    program_pass2 = null;
    pck_tx.reconfigure();
  }
  reconfig_fbo();

  print(`pid and WebGL configured: ${width}x${height} source format ${pf}`);
}

filter.update_arg = function(name, val)
{
}


filter.process = function()
{
  //get a frame from source
  let ipck = ipid.get_packet();
  if (!ipck) return GF_OK;
  //see below: until output frame is not released, do nothing
  if (filter.frame_pending) {
    return GF_OK;
  }
  //activate our WebGL context for this function
  gl.activate(true);

  //upload frame to GPU (GPAC's way)
  pck_tx.upload(ipck);
  //these two lines are equivalent to the above line in regular WebGL/OpenGL syntax
//  gl.bindTexture(gl.TEXTURE_2D, pck_tx);
//  gl.texImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, ipck);

  //GLSL program not setup, do it now 
  if (!program_pass1) {
      program_pass1 = setupProgram(gl, vsSource, fsSource);
      program_pass1.uniformLocations.texture = gl.getUniformLocation(program_pass1.program, 'vidTx');

      program_pass2 = setupProgram(gl, vsSource, fsSource2);
      program_pass2.uniformLocations.texture = gl.getUniformLocation(program_pass2.program, 'imgTx');
  }


  // Draw the scene:
  //first pass using our source but on our intermediate fbo
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);  
  drawScene(gl, program_pass1, pck_tx);
  //second pass using our intermediate texture on main fbo
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);  
  drawScene(gl, program_pass2, off_tx);


  //flush all GPU commands before releasing
  gl.flush();
  gl.activate(false);

  //create packet from webgl framebuffer, using a callback function to notfify when the output packet is consummed
  let opck = opid.new_packet(gl, () => { filter.frame_pending=false; }, filter.depth );
  this.frame_pending = true;
  //copy property of input packet to output (timing, atc ...)
  opck.copy_props(ipck);

  //done with the input packet we can trash it. If designing an effect accumulating several frames, you may need to keep a reference to the input packet
  //but you still have to drop the input packet from the PID 
  ipid.drop_packet();

  //and send
  opck.send();
  nb_frames++;
  return GF_OK;
}

function reconfig_fbo()
{
  fbo_width = width/scaler;
  fbo_height = height/scaler;
  //prepare texture for our FBO, passing 0 bytes 
  gl.bindTexture(gl.TEXTURE_2D, off_tx);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fbo_width, fbo_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, off_tx, 0);

  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

}


function drawScene(gl, prog_info, tx_pass) {
  //if first pass, we draw on our fbo
  if (tx_pass===pck_tx)
    gl.viewport(0, 0, fbo_width, fbo_height);
  else
    gl.viewport(0, 0, width, height);
  //define our clear color, here black
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.disable(gl.DEPTH_TEST);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthFunc(gl.LEQUAL);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const aspect = width / height;

  //since we use a square [-1,1] for the geometry, using an orthographic projection matrix in [-1,1] will fit the [width,height] viweport completely 
  const projectionMatrix = new Matrix().ortho(-1, 1, -1, 1, -50, 50);

  const modelViewMatrix = new Matrix();
//  const modelViewMatrix = new Matrix().translate(-0.0, 0.0, -6.0).rotate(0, 1, 0, nb_frames*Math.PI/100);

  //bind vertex position - we still keep 3 components per vertex, even though we could use only 2 in 2D
  {
    const numComponents = 2;
    const type = gl.FLOAT;
    const normalize = false;
    const stride = 0; //no stride (no extra data between coords of each vertex)
    const offset = 0; //start from begining of array

    //bind the buffer previously created
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    //set our vertices to the bound buffer -  attribLocations.vertexPosition holds the position to 'aVertexPosition' in the vertex shader
    gl.vertexAttribPointer(
        prog_info.attribLocations.vertexPosition,
        numComponents,
        type,
        normalize,
        stride,
        offset);
    gl.enableVertexAttribArray(prog_info.attribLocations.vertexPosition);
  }

  //bind texture coordinates - the same in 2D using the position of 'aTextureCoord' in the vertex shader
  {
    const num = 2; // chaque coordonnée est composée de 2 valeurs
    const type = gl.FLOAT; // les données dans le tampon sont des flottants 32 bits
    const normalize = false; // ne pas normaliser
    const stride = 0; // combien d'octets à récupérer entre un jeu et le suivant
    const offset = 0; // à combien d'octets du début faut-il commencer
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.textureCoord);
    gl.vertexAttribPointer(prog_info.attribLocations.textureCoord, num, type, normalize, stride, offset);
    gl.enableVertexAttribArray(prog_info.attribLocations.textureCoord);
  }

  //say we use this program
  gl.useProgram(prog_info.program);

  //set uniforms, i.e our projection matrix and our modelview matrix
  gl.uniformMatrix4fv(prog_info.uniformLocations.projectionMatrix, false, projectionMatrix.m);
  gl.uniformMatrix4fv( prog_info.uniformLocations.modelViewMatrix, false, modelViewMatrix.m);

  //set video texture as first texture unit
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tx_pass);
  gl.uniform1i(prog_info.uniformLocations.texture, 0);

  //bind indices buffer
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
  const vertexCount = 6;
  const type = gl.UNSIGNED_SHORT;
  const offset = 0;
  //draw elements according to the indices buffer
  gl.drawElements(gl.TRIANGLES, vertexCount, type, offset);
}


/*inspired from MDN samples
https://github.com/mdn/webgl-examples/tree/gh-pages/tutorial
*/

//vertex shader: projection of the vertex and passing the texture coordinates to the next stage
const vsSource = `
attribute vec4 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
varying vec2 vTextureCoord;
void main() {
  gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
  vTextureCoord = aTextureCoord;
}
`;


//fragment shader: this is where most of your effects will take place !
const fsSource = `
varying vec2 vTextureCoord;
uniform sampler2D vidTx;
void main(void) {
  vec2 tx = vTextureCoord;
  tx.y = 1.0 - tx.y;
  vec4 vid = texture2D(vidTx, tx);
  gl_FragColor = vid;
}
`;



//fragment shader: this is where most of your effects will take place !
const fsSource2 = `
varying vec2 vTextureCoord;
uniform sampler2D imgTx;
float scale = 10.0;
void main(void) {
  vec2 tx = vTextureCoord;
  vec4 col = texture2D(imgTx, tx);
  col.r = floor(col.r * scale ) / scale;
  col.g = floor(col.g * scale ) / scale;
  col.b = floor(col.b * scale ) / scale;
  gl_FragColor = col;
}
`;


function setupProgram(gl, vsSource, fsSource)
{
  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  return {
    program: shaderProgram,
    attribLocations: {
      vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
      textureCoord: gl.getAttribLocation(shaderProgram, 'aTextureCoord'),
    },
    uniformLocations: {
      projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
      modelViewMatrix: gl.getUniformLocation(shaderProgram, 'uModelViewMatrix'),
    },
  };
}


function initBuffersRect(gl) {
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  
  const positions = [
    // Front face
    -1.0, -1.0,
     1.0, -1.0,
     1.0,  1.0,
    -1.0,  1.0
  ];

  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  const indices = [
    0,  1,  2,      0,  2,  3,
  ];
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  const textureCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
  const textureCoordinates = [
    // Front
    0.0,  0.0,
    1.0,  0.0,
    1.0,  1.0,
    0.0,  1.0,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), gl.STATIC_DRAW);

  return {
    position: positionBuffer,
    indices: indexBuffer,
    textureCoord: textureCoordBuffer,
  };
}



//loads vertex and fragment shader, create program and link it
function initShaderProgram(gl, vsSource, fsSource) {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

  const shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    alert('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
    return null;
  }
  return shaderProgram;
}

//load shader source and compiles it
function loadShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert('An error occurred compiling the shaders ' + type + ' : ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}