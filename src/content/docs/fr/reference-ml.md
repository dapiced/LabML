---
slug: reference-ml
kind: reference
order: 2
title: Référence — ML Lab
summary: Ce que fait chaque panneau du ML Lab, ce qu'il calcule exactement, et ce qu'il ne prétend pas faire.
---

À consulter, pas à lire. Un panneau par section, dans l'ordre où ils
apparaissent sous le classement.

:::try /ml?demo=titanic&target=survived | Ouvrir le ML Lab, titanic prêt

## Lecture du fichier

Le fichier est lu dans le navigateur. L'encodage est décidé **en essayant** :
UTF-8 en mode strict échoue sur des accents cp1252, donc le repli est une
certitude et non une préférence. Le délimiteur est le candidat qui découpe
chaque ligne échantillonnée en le même nombre de colonnes. Le séparateur
décimal est décidé **par colonne**, jamais par fichier, et une colonne n'est
réécrite que si au moins 90 % de ses valeurs sont des nombres sous cette forme.

La lecture est annoncée avec ses compteurs quand elle s'écarte du défaut. Un
fichier UTF-8 à virgules ne déclenche aucune carte : pas de friction pour le
cas ordinaire.

## Profil et choix de la cible

Chaque colonne reçoit un type inféré (numérique, catégorielle, booléenne,
texte, date), son nombre de valeurs distinctes, son taux de valeurs manquantes
et ses extrêmes. Choisir une cible déclenche la détection de tâche
(classification binaire, multiclasse, régression) et la **détection de fuite** :
une colonne qui reflète presque parfaitement la cible est exclue
automatiquement et nommée.

## Entraînement et classement

Huit familles écrites à la main, plus un ensemble, plus une baseline naïve.
Découpe **64 / 16 / 20** — entraînement, validation, test — seedée à 42.

Le gagnant est **élu sur la validation** ; le chiffre publié vient du **test**,
jamais touché pour choisir. L'écart entre les deux est affiché : c'est le prix
de la sélection, et le cacher rendrait le score flatteur.

La baseline répond toujours la classe majoritaire (ou la moyenne en
régression). Un modèle qui ne la dépasse pas n'a rien appris, quel que soit son
score absolu.

## Solidité des chiffres

Le jeu de test est rééchantillonné 1 000 fois par bootstrap et la métrique
recalculée à chaque fois ; l'intervalle est l'endroit où elle atterrit 95 fois
sur 100. Les tirages sont **appariés** entre modèles, donc les comparaisons
sont légitimes. Ces intervalles mesurent la sensibilité au tirage du test —
**pas** la variance d'entraînement, et le panneau le dit.

Un intervalle large est une information, pas un défaut.

## Le classement est-il réel ?

À la demande : 5 répétitions × 2 moitiés, dix ajustements par famille, avec
moyenne, dispersion, et la fréquence à laquelle le leader bat réellement le
second. Le jeu de test reste **hors** des plis : ceci reclasse, cela ne
re-teste pas.

## Recherche d'hyperparamètres

Recherche aléatoire seedée, jusqu'à 16 configurations, notées par validation
croisée 3 plis **sur l'entraînement seul**. Le test est scoré exactement une
fois, à la fin.

## Courbe d'apprentissage

Un modèle réentraîné sur des fractions croissantes et emboîtées de
l'entraînement, chacune scorée sur le même test complet, avec une bande
bootstrap. Si la courbe monte encore au bord droit, collecter plus de lignes
vaut le coup ; si elle est plate, travaillez les variables ou le modèle.

## Explications

- **Lecture en clair** : le score, l'écart à la baseline, le rappel, les
  colonnes décisives.
- **Matrice de confusion**, **courbe ROC**, **importance par permutation**
  (agnostique au modèle : la chute de justesse quand la colonne est mélangée).
- **Dépendance partielle** : la prédiction moyenne quand une colonne balaie sa
  plage, tout le reste inchangé.
- **What-if** : éditez les valeurs, la prédiction se recalcule localement.

## Seuil de décision

Courbe précision-rappel, courbe de calibration, et un seuil que **vous**
décidez, chiffré par vos coûts de faux positif et de cas manqué. Une
probabilité n'est pas une décision ; le seuil est enregistré avec le run.

## Où le modèle échoue

Le test est découpé par chaque colonne catégorielle — **y compris celles hors
des variables**, où des effets de proxy peuvent se cacher. Les tranches de
moins de 8 lignes sont exclues. Un écart est une piste à examiner, pas un
verdict.

## Exporter, importer, scorer

Le modèle s'exporte en JSON avec son manifeste : famille, pipeline, versions.
Il se réimporte dans une session vierge et score un CSV. Les cinq raisons de
refus à l'import sont nommées — voir la [page des refus](/docs/refus).

## Comparer des runs

Deux runs côte à côte (`/ml/compare/:a/:b`) ou jusqu'à six
(`/ml/compare-many/:ids`) : configuration, variables ajoutées ou retirées,
classement par modèle, incertitude croisée.

## Et ensuite ?

- [Scorer un nouveau lot](/docs/scorer-un-lot), [comparer deux runs](/docs/comparer-deux-runs), [lire une courbe](/docs/lire-une-courbe) — les gestes, un par page.
- [Les choix de méthode](/docs/methode) — pourquoi la baseline, les intervalles et la graine 42.
