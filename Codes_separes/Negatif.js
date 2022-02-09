const name = 'negatif'

const uniforms = [];

const code = `
	vid.rgb = 1.0 - vid.rgb;
`;

export { name, uniforms, code };