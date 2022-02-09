const name = 'BAndW';

const uniforms = [];

const code = `
    vid.rgb = vec3((vid.r + vid.g + vid.b)/3.0);
  `;

export { name, uniforms, code };