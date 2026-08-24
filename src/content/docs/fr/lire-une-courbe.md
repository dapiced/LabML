---
slug: lire-une-courbe
kind: how-to
order: 3
title: Lire une courbe d'apprentissage
summary: Répondre à « faut-il collecter plus de données ? » avec un graphique plutôt qu'une intuition.
---

## Le geste

1. Entraînez un modèle.
2. Ouvrez **Plus de données aideraient-elles ?** sous le classement.
3. Choisissez un modèle et lancez le tracé.

LabML réentraîne ce modèle sur des fractions **croissantes et emboîtées** du
jeu d'entraînement, et score chacune sur le **même jeu de test complet**.

## Comment la lire

Regardez le **bord droit** de la courbe.

| Ce que vous voyez         | Ce que ça veut dire                                      | Quoi faire                                           |
| ------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Elle monte encore         | Le modèle n'a pas fini d'apprendre de vos données        | Collecter plus de lignes vaut le coup                |
| Elle est plate            | Plus de lignes ne changeront rien                        | Travailler les variables, ou changer de modèle       |
| Elle monte puis redescend | Rare ; souvent un signe de fuite ou de découpage douteux | Vérifier le [détecteur de fuite](/docs/reference-ml) |

La bande autour de la courbe est un intervalle bootstrap. Si elle est large au
bord droit, la pente que vous croyez voir peut être du bruit.

## Pourquoi des fractions emboîtées

Chaque taille est un **préfixe** de la suivante : les 200 premières lignes sont
incluses dans les 400. Sans ça, chaque point tirerait un échantillon différent
et la courbe mesurerait la chance du tirage autant que l'effet de la taille.

## Ce que la courbe ne dit pas

Elle ne dit pas combien de lignes il faudrait. Extrapoler une courbe
d'apprentissage au-delà de ce qu'on a mesuré est une supposition, et LabML n'en
propose pas.

## Et ensuite ?

- [Comparer deux runs](/docs/comparer-deux-runs) pour mesurer un changement de variables.
- [Les choix de méthode](/docs/methode) sur pourquoi la baseline vient d'abord.
