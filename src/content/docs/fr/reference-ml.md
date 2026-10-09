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

Pendant un entraînement, et pendant tout calcul qui en dépend (recherche
d'hyperparamètres, courbe d'apprentissage, classement robuste, scoring d'un
lot), la cible et les colonnes sont **verrouillées**. Les changer à ce
moment-là classerait les résultats sous une question à laquelle ils ne
répondent pas ; il faut attendre la fin ou annuler.

## Entraînement et classement

Huit familles écrites à la main, plus un ensemble, plus une baseline naïve.
Découpe **64 / 16 / 20** — entraînement, validation, test — seedée à 42.

Le gagnant est **élu sur la validation** ; le chiffre publié vient du **test**,
jamais touché pour choisir. L'écart entre les deux est affiché : c'est le prix
de la sélection, et le cacher rendrait le score flatteur.

La baseline répond toujours la classe majoritaire (ou la moyenne en
régression). Un modèle qui ne la dépasse pas n'a rien appris, quel que soit son
score absolu.

La découpe est stratifiée par classe. Une classe qui n'a **qu'une seule
ligne** reste du côté entraînement : l'envoyer au test laisserait les modèles
sans aucun exemple d'elle. Si toutes les classes n'ont qu'une ligne, il ne
reste rien à tester, et l'entraînement refuse avec `too-few-rows` plutôt que
de publier des métriques calculées sur un ensemble vide.

Précision, rappel et F1 sont des moyennes **macro**, calculées comme dans
scikit-learn : sur les classes présentes dans les vraies valeurs ou dans les
prédictions. Une classe absente des deux ne compte pas comme un zéro ; une
classe prédite mais jamais vraie compte, parce que ces prédictions sont toutes
fausses.

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

## Décider en multiclasse

Au-delà de deux classes, un seul curseur ne suffit plus. Le panneau de décision
multiclasse donne **un seuil par classe**, et une règle énoncée : une classe est
candidate si sa probabilité atteint son seuil ; entre plusieurs candidates, celle
dont l'excédent normalisé est le plus grand l'emporte ; les égalités sont
tranchées par l'ordre des classes, toujours le même.

Quand aucune classe n'atteint son seuil, la règle **s'abstient** et le dit. Elle
ne retombe pas en silence sur la classe la plus probable — c'est précisément ce
qu'un seuil sert à empêcher. Mettre tous les seuils à zéro reproduit exactement
l'argmax, avec une couverture totale : la règle par défaut ne change rien tant
que vous n'avez rien demandé.

Deux justesses sont affichées côte à côte : la justesse globale, où une
abstention compte comme une erreur, et la justesse conditionnelle aux lignes
décidées. La première répond à « que vaut le système », la seconde à « que vaut
la règle quand elle se prononce ».

L'éditeur travaille sur la **partition de validation**, jamais sur le test. Vous
figez la règle avant de révéler le résultat de test ; la modifier après cette
révélation marque le résultat comme exploratoire plutôt que de laisser croire
qu'il a été obtenu à l'aveugle. Sans partition de validation — un dataset trop
petit, par exemple — le panneau explique pourquoi il ne s'affiche pas.

## Où le modèle échoue

Le test est découpé par chaque colonne catégorielle — **y compris celles hors
des variables**, où des effets de proxy peuvent se cacher. Les tranches de
moins de 8 lignes sont exclues. Un écart est une piste à examiner, pas un
verdict.

## Exporter, importer, scorer

Le modèle s'exporte en JSON avec son manifeste : famille, pipeline, versions.
Il se réimporte dans une session vierge et score un CSV. Une règle de décision
multiclasse figée voyage avec l'export, et le CSV scoré porte alors deux
colonnes de plus — voir [la page des formats](/docs/formats). Les cinq raisons
de refus à l'import sont nommées — voir la [page des refus](/docs/refus).

Un lien de partage transporte les métriques et les graphiques du run dans le
fragment d'URL, jamais les données. Un lien coupé ou abîmé ne donne jamais une
page à moitié lue : s'il ne se décode pas, ou si une partie du run qu'il porte
n'a pas la forme qu'écrit LabML, la page refuse de l'afficher et dit
pourquoi.

## Comparer des runs

Deux runs côte à côte (`/ml/compare/:a/:b`) ou jusqu'à six
(`/ml/compare-many/:ids`) : configuration, variables ajoutées ou retirées,
classement par modèle, incertitude croisée.

## Et ensuite ?

- [Scorer un nouveau lot](/docs/scorer-un-lot), [comparer deux runs](/docs/comparer-deux-runs), [lire une courbe](/docs/lire-une-courbe) — les gestes, un par page.
- [Les choix de méthode](/docs/methode) — pourquoi la baseline, les intervalles et la graine 42.
