---
slug: rejouer-une-prediction
kind: how-to
order: 6
title: Rejouer une prédiction pas à pas
summary: Ouvrir le modèle sur une ligne et lire ce qu'il a fait, les questions d'un arbre, les lignes consultées par un k-NN, les tours d'un boosting.
---

## Le geste

1. Entraînez un modèle et cliquez sur une famille du classement pour l'inspecter.
2. Dans **Et si…**, réglez les valeurs d'une ligne. La prédiction se met à jour.
3. Cliquez sur **Le rejouer pas à pas**.

:::try /ml?demo=titanic&target=survived | Entraîner titanic et rejouer un passager

**Pourquoi cette prédiction ?** (Shapley) dit ce qui a pesé. Le rejeu dit ce qui
s'est passé : les étapes que le modèle a suivies pour cette ligne, dans l'ordre
où il les a suivies. Les deux répondent à des questions différentes et gagnent à
être lus ensemble.

## Ce que chaque famille raconte

| Famille           | Ce que le rejeu montre                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbre de décision | chaque question posée à la ligne, à combien de lignes d'entraînement elle a été posée, et la feuille d'arrivée : combien de lignes d'entraînement la partagent et ce qu'elles sont |
| Forêt aléatoire   | combien de ses 40 arbres ont répondu chaque classe, ou l'étendue de leurs valeurs                                                                                                  |
| k-NN              | les 5 lignes d'entraînement auxquelles la ligne a été comparée : leur numéro dans votre fichier, leur distance, leur cible et leurs colonnes principales                           |
| Gradient boosting | la prédiction tour après tour, les tours qui l'ont le plus déplacée, et l'erreur sur les lignes de validation à mesure que les tours s'ajoutent                                    |

Les autres familles n'ont pas d'étapes à raconter, et le panneau dit pourquoi :
un modèle linéaire ou logistique est une seule somme pondérée que l'explication
de Shapley lit déjà, un réseau mélange toutes les colonnes à la fois, et le
mélange fait la moyenne d'autres modèles.

## Le rejeu est le modèle

Rien n'est approximé. Un rejeu parcourt la structure avec laquelle le modèle
prédit lui-même, et sa dernière étape est la prédiction affichée au-dessus. Cela
a été mesuré avant de construire le panneau : sur les six démos, cinq découpes
chacune, 2 560 lignes de test, le rejeu a donné la réponse du modèle sur chaque
ligne, pour les quatre familles.

La première mesure a trouvé un écart : trois lignes de titanic où la forêt et
son rejeu n'étaient pas d'accord. En cas d'égalité entre deux classes, la
bibliothèque garde la première classe à atteindre le compte le plus haut, dans
l'ordre des arbres, et non la plus petite. Le rejeu fait maintenant de même, et
signale un vote à égalité.

## Des questions dans les unités de votre fichier

Un modèle voit des colonnes encodées : un nombre standardisé, une catégorie
étalée sur des colonnes 0/1. Le rejeu traduit ce qui se traduit exactement :

- un nombre retrouve son unité : `age < 9,5`, pas `age < -1,42` ;
- une colonne 0/1 devient une question sur la catégorie : « sex vaut "male" ? » ;
- un mot d'une colonne de texte libre et un rang de fréquence sont montrés tels
  que le modèle les voit, sous leur nom encodé. Sur la démo reviews, dont les
  colonnes sont du texte, presque toutes les questions de l'arbre sont de ce
  type.

## Lire le boosting

Toutes les lignes partent du même point (la part de la classe à l'entraînement,
ou la moyenne), et chaque tour ajoute une petite correction. Le panneau donne le
tour auquel 90 % du chemin était fait, et raconte jusqu'à trois tours en entier :
les plus grands déplacements parmi ceux qui posent des questions différentes,
chacun avec le nombre d'autres tours qui ont posé exactement les mêmes à cette
ligne.

Il montre aussi l'erreur sur les **lignes de validation** à mesure que les tours
s'ajoutent. Sur les démos, l'erreur de validation la plus basse arrivait bien
avant le dernier tour sur 17 runs sur 30, et sur la démo energy le boosting n'a
jamais battu son point de départ sur trois découpes sur cinq.

Cela ressemble à une raison de s'arrêter plus tôt, et cela a donc été mesuré
(V67), sur un quart des lignes tenu à l'écart de tout, dix découpes par démo.
S'arrêter au point le plus bas de la courbe, face aux 120 tours que fait le
labo :

| Démo    | Exactitude ou RMSE sur les lignes tenues à l'écart | Log loss                         |
| ------- | -------------------------------------------------- | -------------------------------- |
| titanic | +0,4 point (mieux 5 fois, pire 4)                  | meilleure sur 10 découpes sur 10 |
| fraud   | aucun changement                                   | un peu moins bonne               |
| iris    | aucun changement                                   | un peu moins bonne               |
| reviews | **4 points de moins** (pire 6 fois, mieux 2)       | meilleure sur 10 découpes sur 10 |
| mpg     | aucun changement                                   | aucun changement                 |
| energy  | RMSE 3,5 % plus basse (mieux 9 fois, pire 1)       | la même mesure                   |

Moins de tours donnent de meilleures probabilités, pas de meilleures
prédictions : les classes prédites ne sont pas plus justes, et sur reviews elles
le sont moins. Le seul gain est sur energy, où le boosting ne fait pas mieux que
la moyenne et n'est jamais la famille que les lignes de validation choisissent.
Le labo garde donc ses 120 tours. La courbe dit où l'erreur a tourné ; elle ne
dit pas que moins de tours prédiraient mieux. Elle se lit sur la validation,
jamais sur le jeu de test.

## Les ex æquo d'un k-NN

Quand la ligne suivante est exactement aussi loin que le dernier voisin gardé,
un autre ordre des lignes ou une autre bibliothèque aurait gardé l'autre, et la
réponse peut changer avec elle. C'est fréquent quand les colonnes ont peu de
valeurs distinctes : 17 % des lignes de test sur titanic, 39 % sur energy. Le
panneau le signale sur la ligne concernée.

## Une trace n'est pas une cause

Le chemin d'un arbre dit quelles questions ont été posées à cette ligne. Il ne
dit pas qu'une colonne fait la réponse : un autre arbre, entraîné sur une autre
découpe, poserait d'autres questions et tomberait souvent sur la même prédiction.

## Et ensuite ?

- [Lire une courbe d'apprentissage](/docs/lire-une-courbe) pour voir si plus de lignes aideraient.
- [La référence du ML Lab](/docs/reference-ml) pour ce qu'est chaque famille.
- [Les limites](/docs/limites) pour ce que le rejeu ne fait pas.
