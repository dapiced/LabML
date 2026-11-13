---
slug: reference-data
kind: reference
order: 3
title: Référence — Data Studio
summary: Score de qualité, règles de validité, recette par colonne, jointure, dérive, anomalies et console SQL.
---

:::try /data | Ouvrir le Data Studio

## Lecture du fichier

Le Studio lit un fichier avec le même lecteur que le ML Lab : encodage tranché
par décodage, séparateur et virgule décimale détectés par colonne, lignes
malformées comptées. Le même budget mémoire s'applique, lignes × colonnes
plafonné à 20 millions de cellules ; au-delà, la lecture s'arrête à cette ligne
et la page dit où (`too-large`), au lieu de laisser tomber l'onglet.

Un fichier chargé pour un **contrôle de dérive** ou une **jointure** est lu de
la même façon, décimales comprises. Comparer un export français à un jeu
normalisé signalerait sinon une dérive qui n'est qu'une virgule décimale.

## Score de qualité

Un score décomposé en parties, chacune avec son poids et ce qu'elle a
réellement coûté. Les poids somment à **105, pas 100** : la validité a apporté
ses 5 points au lieu de les prendre aux autres, parce que redistribuer aurait
silencieusement changé le sens de tous les scores déjà publiés.

## Règles de validité

Une valeur peut être présente, bien typée, et pourtant impossible. Cinq règles
nommées : âge hors 0–120, date dans le futur, pourcentage hors 0–100, montant
négatif, code postal malformé.

Elles obéissent à deux lois : elles se déclenchent **sur des preuves, jamais
sur le nom d'une colonne** — une colonne nommée `age` contenant 20 000 est une
durée en jours, donc la règle vérifie d'abord que l'essentiel de la colonne est
plausible — et elles **signalent sans jamais réparer**.

## Cohérence entre colonnes

Chaque cellule correcte, la **ligne** impossible : une date de fin avant son
début, un total qui n'est pas quantité × prix. Calculé en mémoire, pas via
DuckDB : router une vérification universelle à travers un téléchargement
optionnel de 18–22 Mo l'aurait rendue conditionnelle.

## Recette

Une liste ordonnée d'étapes **par colonne**, les réglages globaux devenant des
défauts qu'une colonne peut surcharger. Une colonne sans entrée se comporte
exactement comme avant : c'est ce qui garde valides toutes les recettes
exportées auparavant.

Stratégies de valeurs manquantes : médiane, moyenne, plus fréquente, constante
littérale, ou catégorie « MANQUANT ».

**Imputer sans marquer détruit de l'information.** Un blanc est rarement
aléatoire, et le fait du blanc est souvent prédictif. Chaque colonne peut
ajouter un indicateur `<colonne>_absent`, et **tous les indicateurs sont écrits
avant qu'un seul blanc soit rempli**. Quand une stratégie ne peut pas être
honorée, les blancs sont **laissés blancs** plutôt que remplis d'une invention.
Les colonnes remplies sans marquage sont annoncées par leur nom.

## Diff avant / après

Quelles lignes, quelles colonnes, quelles valeurs ont changé. La partie
difficile : une recette supprime des lignes et en ajoute des colonnes, donc
`applyRecipe` renvoie de quelle ligne **source** vient chaque ligne survivante
— sans quoi le diff apparierait la ligne 7 avec une autre ligne 7.

## Jointure

Jointure gauche sur une clé, avec ses statistiques : taux de correspondance,
lignes orphelines, doublons de clé, colonnes ajoutées. Comparaison exacte après
suppression des espaces de bord.

## Dérive

Deux fichiers comparés : schéma, PSI par colonne sur des bins de quantiles,
catégories apparues ou disparues, sévérités. Un **profil de référence
rejouable** stocke bins et parts — jamais de lignes —, ce qui le rend sûr à
committer à côté du code.

Une sévérité n'est donnée qu'à un PSI qui **dépasse son plafond de bruit**.
Deux échantillons des mêmes données ne tombent jamais dans les mêmes tranches :
sur B tranches, leur PSI vaut en moyenne environ (B − 1) × (1/n + 1/n_réf), soit
0,11 pour dix tranches et 100 lignes contre 500. La lecture habituelle (sous 0,1
stable, de 0,1 à 0,25 modéré, au-delà de 0,25 fort) prend donc un petit fichier
pour une dérive.

| PSI           | Sous son plafond | Au-dessus de son plafond |
| ------------- | ---------------- | ------------------------ |
| sous 0,1      | stable           | stable                   |
| de 0,1 à 0,25 | dans le bruit    | dérive modérée           |
| 0,25 et plus  | dans le bruit    | dérive forte             |

Le plafond est la valeur sous laquelle un PSI reste, 95 rapports sur 100, quand
les deux fichiers sont deux tirages des mêmes données à leurs tailles réelles.
Il est simulé avec une graine fixe, à partir des deux fichiers mis en commun, et
affiché à côté du PSI. Mesuré sur deux moitiés d'un même fichier, où toute
alerte est fausse : les seuils fixes signalaient 95 à 100 % des rapports sur des
fichiers de 120 et 400 lignes, et encore 21 à 52 % à 640 et 890 lignes ; le
plafond en signale 0,5 à 9,5 %. Rien ne change pour un gros fichier, dont le
plafond est bas.

## Anomalies

Isolation forest écrite à la main et seedée : 100 arbres, sous-échantillon 256,
c(n) exact. Rejouable depuis la recette.

## Console SQL

DuckDB-Wasm, MIT, auto-hébergé, mono-thread (pas d'en-têtes COOP/COEP). Épinglé
à **1.28.0** pour une raison mesurée : à partir de 1.29 les binaires dépassent
la limite Cloudflare de 25 Mio par fichier.

Interroge le dataset actif plus tout CSV, Parquet ou JSON attaché à la session.
Résultats exportables en CSV ou transférables au ML Lab en un clic. Export
**Parquet** par `COPY … TO`.

## Et ensuite ?

- [Passer un résultat SQL au ML Lab](/docs/sql-vers-le-lab) — le geste le plus utile de cette section.
- La [référence du ML Lab](/docs/reference-ml) pour ce qui se passe ensuite.
