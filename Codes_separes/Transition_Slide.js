//Transition Slide

const name = 'slide';

const buffer = false;

const uniforms = [{name: 'uniform float slide_seuil_w', default: 'width*(nb_frames%100/100)', description: 'défini la largeur à laquelle la transition se fait'}, {name: 'slide_seuil', default : '(nb_frames%100)/100', description: 'largeur entre 0 et 1'}]

const codetx = `if (gl_FragCoord.x < slide_seuil_w)
		vec2 inTextureCoord = tx + vec2(1.0-seuil2, 0.0);
	else 
		vec2 inTextureCoord = tx + vec2(-seuil2, 0.0);`;

const code = `{
	if (gl_FragCoord.x < slide_seuil_w)
		vec4 result = result1;
	else
		vec4 result = result2;
}`;


export { name, buffer, uniforms, codetx, code };

//fin du fichier