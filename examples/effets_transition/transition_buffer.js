import {WebGLContext} from 'webgl'
import {Texture, Matrix} from 'evg'


//metadata
filter.set_name("PAF VideoMix Effects");
filter.set_desc("WebGL video mixer generator");
filter.set_version("0.1beta");
filter.set_author("PAF2021 team");
filter.set_help("This filter provides some basic structure for GPU video mixing");

//filter capapbilities: we accept raw video in and produce raw video out
filter.set_cap({id: "StreamType", value: "Video", inout: true} );
filter.set_cap({id: "CodecID", value: "raw", inout: true} );

//we accept one additionnal stream
filter.max_pids=1;

//set to true to draw on primary framebuffer, false to draw on texture
let use_primary = true;
let width=600;
let height=400;
let opid=null;
let nb_frames=0;
let pix_fmt = '';
let program_pass1 = null;
let program_pass2 = null;

let gl = null;
let buffers = null;

let in_error = false;

let pids = [];

//we will use an offscreen buffer for rendering our first pass
let fbo = null;
let off_tx = null;
let fbo_width;
let fbo_height;

let scaler = 1;

filter.initialize = function()
{
  //initialize WebGL
  gl = new WebGLContext(width, height, {depth: filter.depth ? "texture" : true, primary: use_primary});
  //initialize vertices buffers
  buffers = initBuffers(gl);
  if (!gl  || !buffers) return GF_IO_ERR;

  //create an fbo
  fbo = gl.createFramebuffer();
  off_tx = gl.createTexture();
}

//new input video or change of input video format 
filter.configure_pid = function(pid)
{
  if (!opid) {
    opid = this.new_pid();
  }
  //new input pid
  if (pids.indexOf(pid)<0) {
    pids.push(pid);
    //create texture for input packets, with no associated data yet
    pid.tx_name = 'vidTx' + pids.length; 
    pid.pck_tx = gl.createTexture(pid.tx_name);
    pid.pix_fmt = '';
    pid.send_event(new FilterEvent(GF_FEVT_PLAY) );
  }
  //copy output props from first pid only
  if (pids.indexOf(pid) == 0) {
    opid.copy_props(pid);
    opid.set_prop('PixelFormat', 'rgba');
    opid.set_prop('Stride', null);
    opid.set_prop('StrideUV', null);
    let n_width = pid.get_prop('Width');
    let n_height = pid.get_prop('Height');
    if ((n_width != width) || (n_height != height)) {
      width = n_width;
      height = n_height;
      gl.resize(width, height);
    }
    print(`pid and WebGL configured: ${width}x${height}`);
  }
  //check pid pixel format
  let pf = pid.get_prop('PixelFormat');
  if (pf != pid.pix_fmt) {
    pid.pix_fmt = pf;
    //we delete the GLSL program info so that it will be recomputed upon mloading the next input packets
    program_pass1 = null;
    program_pass2 = null;
    //invalidate the video texture
    pid.pck_tx.reconfigure();
  }
  reconfig_fbo();

}

filter.update_arg = function(name, val)
{
}

filter.process = function()
{
  if (in_error) return GF_BAD_PARAM;
  //waiting for the last emited frame to be consummed
  if (filter.frame_pending) {
    return GF_OK;
  }

  //activate webgl   
  gl.activate(true);

  //fetch packets on each inputs (2 in our case)   
  for (let i=0; i<pids.length; i++) {
    pids[i].pck = pids[i].get_packet();
    if (!pids[i].pck) {
      //we need a packet from each source before setting up 
      if (!program_pass1) return GF_OK;
      continue;
    }
    //push packet to texture data, this will update the internal format of the texture to the video stream format
    pids[i].pck_tx.upload(pids[i].pck);
  }

    //GLSL program not setup, do it now 
    if (!program_pass1) {
      program_pass1 = setupProgram(gl, vsSource, fsSourceMIX);
      program_pass1.uniformLocations.texture1 = gl.getUniformLocation(program_pass1.program, 'vidTx1');
      program_pass1.uniformLocations.texture2 = gl.getUniformLocation(program_pass1.program, 'vidTx2');

      program_pass2 = setupProgram(gl, vsSource, fsSourceFX);
      program_pass2.uniformLocations.texture1 = gl.getUniformLocation(program_pass2.program, 'vidTx1');
	  program_pass2.uniformLocations.texture2 = gl.getUniformLocation(program_pass2.program, 'imgTx')
    }


  // Draw the scene
  //first pass using our source but on our intermediate fbo
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);  
  drawScene(gl, program_pass1, pids[0].pck_tx, pids[1].pck_tx);
  //second pass using our intermediate texture on main fbo
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); 
  drawScene(gl, program_pass2, pids[0].pck_tx, off_tx);

  //flush (execute all pending commands in openGL)
	gl.flush();
  //deactivate
	gl.activate(false);

	//create packet from webgl framebuffer, using a callback function to notify us when we are done
	let opck = opid.new_packet(gl, () => { filter.frame_pending=false; }, filter.depth );
  //remember we wait for the output frame to be consummed - set this before sending the frame for multithreaded cases 
	this.frame_pending = true;

  //we no longer need input packets, drop them (we assume same fps) - once droped, we no longer can use pck_tx until we push a new packet to it 
  for (let i=0; i<pids.length; i++) {
    if (!i && pids[i].pck) opck.copy_props(pids[i].pck);
    pids[i].drop_packet();
    pids[i].pck = null;
  }

  //send output
	opck.send();

  //remember the number of frames sent - you will typically need that for animating your effects. 
  //For example to animate a value between 0 and 1 every 2 seconds (suppose 25 frames per second input)
  //let value = (nb_frames % 50) / 50; 
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

//draw our scene
function drawScene(gl, prog_info, tx1, tx2)
{
  //we fill the whole screen
  gl.viewport(0, 0, width, height);
  gl.clearColor(0.8, 0.4, 0.8, 1.0);
  gl.clearDepth(1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthFunc(gl.LEQUAL);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  //we use an orthogonal projection mapping x coords in [-1,1] to viewport [0,width] and y coords in [-1,1] to viewport [0,height]
  const projectionMatrix = new Matrix().ortho(-1, 1, 1, -1, 1, -1);
  //identity matrix for this example
  const modelViewMatrix = new Matrix();
  //bind vertex position
  {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.vertexAttribPointer(prog_info.attribLocations.vertexPosition, 3 /*numComponents per vertex*/, gl.FLOAT /*component type*/, false /*normalize*/, 0 /*stride*/, 0 /*offset*/);
    gl.enableVertexAttribArray(prog_info.attribLocations.vertexPosition);
  }

  //bind texture coordinates
  {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.textureCoord);
    gl.vertexAttribPointer(prog_info.attribLocations.textureCoord, 2  /*numComponents per texture coord*/, gl.FLOAT /*component type*/, false /*normalize*/, 0 /*stride*/, 0 /*offset*/);
    gl.enableVertexAttribArray(prog_info.attribLocations.textureCoord);
  }

  //say which program we use (we have a single one in this example)
  gl.useProgram(prog_info.program);

  //set uniforms
  gl.uniformMatrix4fv(prog_info.uniformLocations.projectionMatrix, false, projectionMatrix.m);
  gl.uniformMatrix4fv( prog_info.uniformLocations.modelViewMatrix, false, modelViewMatrix.m);
  let s = (nb_frames%120) / 120;
  gl.uniform1f(prog_info.uniformLocations.seuil, s);
  //uniforms don't have to be set at each frame, they can be pushed only when modified
  //your program will likely declare many more uniforms to control the effect

  //activate video textures - first texture unit is 0
  let tx_id = gl.TEXTURE0;
  let tx_unit = 0;
  gl.activeTexture(tx_id);
  gl.bindTexture(gl.TEXTURE_2D, tx1);
  gl.uniform1i(prog_info.uniformLocations.texture1, tx_unit );
  //update texture unit by number of textures used by the texture for this pid
  tx_id += tx1.nb_textures;
  tx_unit += tx1.nb_textures;
  
  if (tx2) {
    gl.activeTexture(tx_id);
    gl.bindTexture(gl.TEXTURE_2D, tx2);
    gl.uniform1i(prog_info.uniformLocations.texture2, tx_unit );
  }




  //bind indices and draw
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
  gl.drawElements(gl.TRIANGLES, 6 /*number of indices to use, here 6 <=> all*/, gl.UNSIGNED_SHORT /*type of indices*/, 0 /*offset in array, 0 means we start from first index*/);
}


/* Vertex shader GLSL code - in our example, we only draw a simple geometry (rectangle) so this will not need to be changed unless you plan on doing so ... */
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


/* Fragment shader GLSL code - this is the code you will have to play with
the example below shows how to mix two videos at 50% when the first video is close to white (RGB= {1, 1, 1}), or keep the first video otherwise
A first good exercice is to replace the constants used (0.9 and 0.5) by uniforms modified at each frame whose values depend on the number of frames drawn 
*/
const fsSourceMIX = `
varying vec2 vTextureCoord;
uniform sampler2D vidTx1;
uniform sampler2D vidTx2;
uniform float seuil;
void main(void) {
  vec2 tx= vTextureCoord;
  vec4 vid1 = texture2D(vidTx1, tx);
  vec4 vid2 = texture2D(vidTx2, tx);
  vid1.rgb = 1.0 - vid1.rgb;
  gl_FragColor = vid2;
}
`;

const fsSourceFX = `
varying vec2 vTextureCoord;
uniform sampler2D imgTx;
uniform sampler2D vidTx1;
uniform float seuil;
void main(void) {
  vec2 tx = vTextureCoord;
  tx.y = 1.0 - tx.y;
  vec4 vid1 = texture2D(imgTx, tx);
  vec4 vid2 = texture2D(vidTx1, tx);
  vid1 = mix(vid1, vid2, seuil);
  gl_FragColor = vid1;
}
`;




//create the shader program and get the uniform location for later calls to setUniform
function setupProgram(gl, vsSource, fsSource)
{
  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  if (!shaderProgram) return null;

  return {
    program: shaderProgram,
    attribLocations: {
      vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
      textureCoord: gl.getAttribLocation(shaderProgram, 'aTextureCoord'),
    },
    uniformLocations: {
      projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
      modelViewMatrix: gl.getUniformLocation(shaderProgram, 'uModelViewMatrix'),
	  seuil: gl.getUniformLocation(shaderProgram, 'seuil'),
    },
  };
}


//create all buffers needed
function initBuffers(gl) {
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

  //buffer containing rectangle vertices
  //single rectangle with z=0  
  const positions = [
    // Front face
    -1.0, -1.0,  0.0,
     1.0, -1.0,  0.0,
     1.0,  1.0,  0.0,
    -1.0,  1.0,  0.0,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  //buffer containing the indices of the vertices composing each triangle
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  //rectangle made of two triangles
  const indices = [
    0,  1,  2,
    0,  2,  3,
  ];
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  //buffer containing texture coordinate per vertex
  const textureCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
  //coordinate textures
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

//create the shaders, load and link the GLSL program
function initShaderProgram(gl, vsSource, fsSource) {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vertexShader || !fragmentShader) return null;

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
//create the shader
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
