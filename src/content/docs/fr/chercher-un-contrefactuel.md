---
slug: chercher-un-contrefactuel
kind: how-to
order: 7
title: Chercher ce qui changerait une prédiction
summary: Pour une ligne, le plus petit changement de ses valeurs qui fait répondre une autre classe au modèle, et jusqu'où s'y fier.
---

## Le geste

1. Entraînez un modèle de classification et cliquez sur une famille du classement
   pour l'inspecter.
2. Dans **Et si…**, réglez les valeurs d'une ligne.
3. Cochez **verrouillée** sur les colonnes qui ne peuvent pas changer pour ce cas :
   un âge, un sexe, un événement passé. Le labo ne les devine pas.
4. Cliquez sur **Que faudrait-il changer ?**

:::try /ml?demo=titanic&target=survived | Entraîner titanic et chercher un changement

Chaque réponse est un changement que vous auriez pu saisir vous-même,
« `pclass` : 3 → 1 », avec un bouton pour le charger dans le formulaire et voir la
prédiction bouger.

## Comment la recherche procède

C'est une recherche qu'on peut suivre, pas une optimisation :

1. **une colonne à la fois.** Chaque valeur que les lignes d'entraînement portent
   pour cette colonne est essayée à la place de celle de la ligne ; la colonne garde
   la plus proche qui change la réponse ;
2. **deux colonnes ensemble**, seulement quand aucune colonne seule ne change la
   réponse ;
3. **jamais trois.** Un changement de cinq colonnes n'est plus une explication.

Seules des valeurs qu'une ligne d'entraînement porte sont essayées : aucun nombre
hors du fichier, aucune catégorie inexistante, rien d'interpolé. Les colonnes de
texte libre ne sont jamais modifiées. Avec trois classes ou plus, vous pouvez
viser une classe en particulier.

Quand rien ne change la réponse dans ces limites, le panneau le dit, et dit
combien de lignes il a essayées. C'est aussi une réponse : pour ce modèle, cette
ligne est loin de toute autre classe.

## Ce que la mesure a montré

Sur les démos de classification, 60 lignes de test par run, sept familles :

| Démo    | Une colonne suffit   | Il en faut deux | Rien trouvé |
| ------- | -------------------- | --------------- | ----------- |
| titanic | 63 à 98 % des lignes | 2 à 30 %        | 0 à 9 %     |
| fraud   | 28 à 100 %           | 0 à 69 %        | 0 à 9 %     |
| iris    | 96 à 100 %           | 0 à 4 %         | aucune      |
| reviews | 0 à 100 %            | 0 à 38 %        | 0 à 100 %   |

Sur reviews, la plupart des modèles ne trouvent rien : la réponse est dans le
texte, que la recherche ne modifie pas.

Deux constats ont façonné le panneau.

## Première lecture : la ligne modifiée existe-t-elle encore ?

Une ligne construite avec des valeurs qui existent chacune peut ne ressembler à
aucune ligne. La première recherche gardait le changement le plus proche quel
qu'il soit, et **8 à 60 % de ses réponses étaient plus loin de toute ligne
d'entraînement que les lignes d'entraînement ne le sont d'ordinaire entre elles** :
le modèle répondait là où il n'avait rien vu.

La recherche préfère donc, pour chaque colonne, le changement le plus proche qui
reste dans le nuage des lignes d'entraînement, et signale ceux qui n'y restent
pas. Sur iris, environ la moitié des réponses restent signalées quoi qu'on
essaie : ses quatre colonnes bougent ensemble, et en changer une seule fait sortir
du nuage.

Le labo ne sait pas non plus que deux colonnes disent la même chose. Sur titanic,
`sex`, `who` et `adult_male` décrivent un seul fait ; changer `adult_male` seul
décrit un passager qui ne peut pas exister. Verrouillez les colonnes qui en
doublent une autre, ou mieux, retirez-les des variables.

## Seconde lecture : les autres modèles suivent-ils ?

Le plus petit changement qui fait basculer un modèle tombe juste de l'autre côté
de sa frontière. Mesuré : parmi les autres modèles entraînés qui étaient d'accord
sur la ligne, **seuls 14 à 54 % répondaient la nouvelle classe** pour le même
changement.

Chaque réponse dit donc combien d'autres modèles suivent. Un changement que la
plupart suivent dit quelque chose des données. Un changement que seul ce modèle
suit est un bord de ce modèle.

## Un contrefactuel parle du modèle, pas du monde

« Le modèle répondrait oui avec un revenu de 52 » n'est pas « gagnez 52 et vous
aurez oui ». Le modèle a appris quelles valeurs vont ensemble dans le fichier, pas
ce qui cause quoi. Servez-vous d'un contrefactuel pour comprendre et contester un
modèle, pas comme d'un conseil à la personne que la ligne décrit.

## Et ensuite ?

- [Rejouer une prédiction](/docs/rejouer-une-prediction) pour lire les étapes suivies par le modèle.
- [Les limites](/docs/limites) pour ce que la recherche ne fait pas.
- [La référence du ML Lab](/docs/reference-ml) pour le reste du panneau « Et si… ».
