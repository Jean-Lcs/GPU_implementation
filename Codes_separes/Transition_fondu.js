//Transition fondu

const name = "fondu";

const buffer = false;

const uniforms = [{name: 'uniform float fondu_seuil', default: (nb_frames%100)/100, description: 'nombre entre 0 et 1 qui définit la vitesse du fondu'}];

const codetx = `
	vec2 inTextureCoord = tx;
`;

const code = `
	vec4 result = mix(result1, result2, fondu_seuil);
`;

export { name, buffer, uniforms, codetx, code };

//fin du fichier