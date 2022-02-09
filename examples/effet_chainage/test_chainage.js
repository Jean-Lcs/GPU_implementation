const fsSource = `
varying vec2 vTextureCoord;
uniform sampler2D vidTx1;


uniform float seuil;
uniform float width;
uniform float seuil2;



vec4 effet_contraste(sampler2D vidTx1,vec2 vTextureCoord) {
  vec2 tx= vTextureCoord;
  vec4 vid = texture2D(vidTx, tx);
  if (gl_FragCoord.x < 300.0)
    if (vid.r>0.5)
      vid.r=vid.r+(1-vid.r)/1000;
    else
      vid.r=vid.r*(999/1000);

    if (vid.g>0.5)
      vid.g=vid.g+(1-vid.g)/1000;
    else
      vid.g=vid.g*(999/1000);

    if (vid.b>0.5)
      vid.b=vid.b+(1-vid.b)/1000;
    else
      vid.b=vid.b*(999/1000);
  return vid;
}

vec4 effet_BAndW(sampler2D vidTx1, vec2 vTextureCoord) 
{
  vec2 tx= vTextureCoord;
  vec4 vid = texture2D(vidTx, tx);
  if (gl_FragCoord.x > 300.0)
    vid.rgb = vec3((vid.r+vid.g+vid.b)/3.0) ;
  return vid;
}

void main(void)
{
  vec4 v1 = effet_contraste(vidTx1,vTextureCoord);
  gl_FragColor = effet_BAndW(v1, vTextureCoord);
}
`;