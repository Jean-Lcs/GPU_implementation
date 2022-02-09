# Projet PAF Effets Video sur GPU

## Contexte

But: découvrir WebGL et le fonctionnement des GPUs 

But non avoué: ajouter des effets vidéos simples et de transition à un projet open-source développé par Telecom Paris dont je suis le responsable :)

## Ressources logicielles

### GPAC
Vous aurez à utiliser GPAC (http://gpac.io) comme logiciel de base pour votre projet, une plateforme multimédia développée à Telecom Paris. Vous n'aurez à priori pas de modifications à apporter au logiciel, tout votre projet étant codé en JavaScript.
Le logiciel est disponible sur http://gpac.io, vous pouvez faire des tests d'installation dès à présent.

Veillez à installer uniquement des « nightly builds » : 
https://gpac.wp.imt.fr/downloads/gpac-nightly-builds/

Sous linux, seuls les paquets pour ubuntu 18.04 sont disponibles. Pour d’autres systèmes ou version, il vous faudra compiler vous-même en suivant ce guide :

https://github.com/gpac/gpac/wiki/GPAC-Build-Guide-for-Linux

Pour les autres plateformes, si vous voulez compilez GPAC, les instructions d'installation sont disponibles ici: http://wiki.gpac.io/Build-Introduction. D'expérience, la mise en place est beaucoup plus compliquée sous windows que sous linux ou macos.


### Votre projet
Vous utiliserez le dépôt git suivant pour votre code :
git clone https://gitlab.telecom-paris.fr/PAF/2021/gpu_fx 
cd gpu_fx

Libre à vous d'avoir d'autres branches de travail sur gitlab ou github ou autres, cependant je vous demanderai de pousser vos résultats uniquement sur ce dépôt et sur la branche master (il va falloir merger!).

### Edition JavaScript
Vous êtes libres d'utiliser vos éditeurs de textes ou autres IDE favoris, faites seulement attention à ne pas polluer le dépôt GIT avec des fichiers de configuration de ces éditeurs.


## Ressources biblio

### GPAC
Vous aurez besoin de comprendre un minimum comment coder des filtres (unités de traitement multimédia, dans votre cas vidéo) en JavaScript pour GPAC. Vous avez pour cela différentes ressources biblio:
- la documentation officielle des API JavaScript GPAC: https://doxygen.gpac.io/group__jsapi__grp.html
- des exemples de tests dans https://github.com/gpac/testsuite/tree/master/media/jsf et des tutoriels
- le concepteur pour vous aider (donc il ne faudra pas hésiter à poser des questions)

### WebGL
Nous utiliserons WebGL 1.0 pour les effets vidéos. C'est une interface de programmation JavaScript autour de OpenGL ES 2.0. 

L'API WebGL que vous utiliserez dans GPAC est très légèrement modifiée (cf tuto webgl), mais le reste identique. Les extensions WebGL ne sont pas supportées.

L'API peut être relativement compliquée à comprendre, il existe un bon nombre de tutoriels disponible en ligne, commencez par :
https://developer.mozilla.org/fr/docs/Web/API/WebGL_API/Tutorial

Des exemples intéressants pour votre projet:
https://webgl-shaders.com/

Un mini-cours PACT sur la 3D pour commencer à comprendre les concepts:
https://perso.telecom-paristech.fr/lefeuvre/PACT/OpenGL/Synthese-Graphique.pdf

### JavaScript
Il existe beaucoup de ressources pour la syntaxe du langage JavaScript, je vous laisse chercher la plus "claire" selon vos critères, sinon vous pouvez commencer par https://www.w3schools.com/js/

La version du language JavaScript supportée par GPAC est EcmaScript 2020.

## Outils et Modalités
- tout rendu logiciel devra être poussé sur le gitlab GPAC.
- choisissez le canal de communication qui vous convient le mieux (skype/slack/...) et créer un espace pour tous les membres et votre encadrant, afin que nous puissions échanger en temps quasi réel.
- N'hésitez pas à me déranger !
- envoi __TOUS LES SOIRS__ avant 18h30 d'un mini-rapport d'avancement (10 lignes max) récapitulant ce qui a été fait dans la journée par __l'ensemble du groupe__.


# Début de projet (Jour 1)
Commencez à jouer !
- deux vidéos (mp4 ou autre)
- GPAC installé
- Dans votre dépôt git, repertoire examples, vous trouverez deux examples, paf_gpu_fx.js pour tester les effets sur une seule video, et paf_gpu_vmix.js  pour tester les effets de mélanges de vidéo.
Executez via ligne de commande (n’oubliez pas le ‘@’):
gpac -i video1.mp4 paf_gpu_fx.js @ vout

gpac -i video1.mp4 -i video2.mp4 paf_gpu_vmix.js @ vout

Le code utilise uniquement un rectangle en plein écran et une projection orthogonale (le code de rendu hors shaders est le même dans ces deux exemples). 
Etudiez ce code, changer les effets en fonctions de vos idées, essayez d’ajouter un uniform permettant de contrôler chacun de ces effets.

Tout le monde doit avoir fait cet exercice pour commencer à comprendre un peu mieux OpenGL/WebGL.

Vous pouvez maintenant commencer à réfléchir :
- au type d'effets vidéo simples que vous comptez mettre en place (avec ce que vous avez compris de WebGL)
- lister quelques effets vidéos plus complexes et vous poser la question de ce qu'il faudrait faire.

_Note_
Les entrées spécifiées ne sont pas obligatoirement des fichiers locaux, il peut s'agir aussi de flux réseaux ou de webcam. 

Pour utiliser la webcam avec le premier exemple:

gpac -i video:// paf_gpu_fx.js @ vout

(le support webcam peut varier selon les plateformes).

# But global du projet
Il s'agira dans un premier temps de proposer différents effets vidéo simple et transition (mix video). Inspirez-vous de ce que vous pouvez trouver sur le web. Dans l'idéal vous pouvez ezzayer d'importer certains de ces effets directement dans votre code via les outils de chargement dynamique de code de JavaScript (modules et directive _import_ ).

Dans un second temps, vous allez vite vous appercevoir qu'un fois vos premiers effets en place (par ex fxA, fxB et mixA), combiner ces effets dans un unique shaders nécessite une ré-écriture complète d'un nouveau shader. Il s'agira alors de proposer une façon intelligent de faire ce travail afin de pouvoir rapidement spécifier mixA( fxA(video1), fxB(video2) ).


**Évolution de l'architecture:**

_Norme de numérotation:_
On utilisera les indices ‘bL’ sur chaque texture (ou texture après effet grâce aux shedders) où:
b: vaut 0 ou 1 (dans le cas ou l’on utilise qu’une seule transition), et indique l’entrée a partir de laquelle l’image arrive.
L est une liste d’entier qui indique les numéros des filtres et effets qui ont étés appliqués à la texture de départ:

Ensuite il faut légèrement modifier l’implémentation des shedders comparé à ce que l’on a fait jusqu’à présent. En effet, puisque qu’on doit réutiliser la sortie de la fonction par la suite (dans le cas de 2 effets à la suite par exemple) il est nécéssaire de faire un ‘return’ d’un vecteur à 4 dimension (car RGBA) dans une image intermédiaire (qui sera donc l’entrée du prochain shedder)

Par exemple, soit A une texture.
A114 est la nouvelle texture construite à partir de A et qui a été placée sur l’entrée 1 et à quoi on a fait subir les effets 1 et 4.



_Nous pouvons maintenant implémenter un pseudo code:_


// A et B sont les 2 textures d’entrée

If ( !shedderi.useNeighbors && !shedderi’.useNeighbors)
	{
		transition( programe( programe(A,shedderi) ,shedderj) , programe( programe(A,shedderi’),shedderj’)
	}
Else
	{
		// Pour l’entrée 0
		If (!shedderi.useNeighbors)
		{
			A0i = programe(A,shedderi)
			A0ij= programe(A0i,shedderj)
		}
		Else
		{
			 A0ij= programe( programe(A,shedderi) ,shedderj)
		}


		// Pour l’entrée 1
		If (!shedderi’.useNeighbors)
		{
			A1i’ = programe(A,shedderi’)
			A1ij’= programe(A1i,shedderj’)
		}
		Else
		{
			 A1ij= programe( programe(A,shedderi) ,shedderj)
		}

		transition( A0ij, A1i’j’)
	}










