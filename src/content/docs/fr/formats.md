---
slug: formats
kind: reference
order: 5
title: Référence — formats de fichiers
summary: Ce que LabML lit, ce qu'il écrit, et la forme exacte du manifeste de modèle.
---

## Ce qui peut entrer

| Format                | Où                  | Notes                                                              |
| --------------------- | ------------------- | ------------------------------------------------------------------ |
| CSV                   | partout             | délimiteur détecté par preuve ; virgule, point-virgule, tabulation |
| TSV                   | partout             | cas particulier du précédent                                       |
| Excel (.xlsx)         | ML Lab, Data Studio | première feuille, première ligne comme en-tête                     |
| Parquet               | console SQL         | lu par DuckDB                                                      |
| JSON                  | console SQL         | tableau d'objets                                                   |
| Modèle LabML (.json)  | ML Lab              | export réimporté, voir plus bas                                    |
| Recette LabML (.json) | Data Studio         | recette exportée puis rejouée                                      |
| Image                 | vision              | JPEG, PNG, WebP — tout ce que le navigateur décode                 |

### Encodage et séparateur décimal

L'encodage est établi **en essayant** : UTF-8 en mode strict lève sur des
accents cp1252, donc le repli est une certitude. Le séparateur décimal est
décidé **par colonne** : une colonne n'est réécrite que si au moins 90 % de ses
valeurs sont des nombres à virgule **et** qu'elle ne serait pas numérique
autrement. Une colonne de texte contenant « vis, tête plate » ressort intacte.

### Dates

Les formats ISO et jour-d'abord sont lus. `31/12/2025` et `31-12-2025`
fonctionnent tous les deux. Quand un fichier est ambigu, l'ambiguïté est
annoncée plutôt que tranchée en silence.

## Ce qui peut sortir

| Format         | Contenu                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| CSV            | dataset nettoyé, prédictions d'un lot, résultat SQL                                                  |
| Parquet        | résultat SQL, via `COPY … TO`                                                                        |
| JSON           | modèle entraîné avec son manifeste ; recette de nettoyage ; profil de référence ; contrat de données |
| HTML           | rapport de run, autonome et lisible hors ligne                                                       |
| HTML, Markdown | fiche de modèle d'un run : son usage, ses données, sa valeur, et ce qui n'a jamais été vérifié       |

## Le manifeste de modèle

Un export de modèle est un JSON qui se réimporte dans une session vierge. Il
contient la famille, ses paramètres appris, le pipeline complet (encodages,
échelles, vocabulaire TF-IDF le cas échéant) et un manifeste :

```json
{
  "app": "LabML",
  "formatVersion": 5,
  "model": "logistic",
  "task": "classification",
  "target": "survived",
  "seed": 42,
  "createdAt": 1759312800000,
  "sourceDataset": { "name": "titanic.csv", "rowCount": 891 },
  "classes": ["0", "1"],
  "testMetrics": { "accuracy": 0.792 },
  "testRows": 179,
  "pipeline": { "specs": [] },
  "featureNames": ["pclass", "sex", "age"],
  "parameters": {}
}
```

`app` et `formatVersion` sont vérifiés avant toute autre chose : un JSON qui
n'est pas un export LabML est refusé par son nom (`not-labml`), pas par un
plantage. Les versions 2 à 5 se réimportent ; une version plus ancienne ou
plus récente est refusée en la nommant (`unsupported-version:N`). Un manifeste
incomplet est refusé (`bad-manifest`) plutôt que complété par des suppositions —
un export auquel on ne peut pas se fier pour prédire ne doit pas prédire.

`testMetrics` et `testRows` conservent le score de test du run qui a produit
l'export : c'est la référence honnête à laquelle comparer un lot futur.

### La référence de production

Depuis le format 5, un export porte une clé `reference` : ce à quoi
ressemblaient les colonnes et les réponses du modèle au moment de l'export,
pour qu'un lot ultérieur puisse leur être comparé.

```json
{
  "reference": {
    "v": 1,
    "rows": 570,
    "columns": [
      {
        "kind": "numeric",
        "column": "age",
        "missingRatio": 0.2,
        "mean": 29.6,
        "edges": [14, 19, 22, 25, 28, 31, 36, 41, 50],
        "shares": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
      },
      { "kind": "categorical", "column": "sex", "missingRatio": 0, "shares": { "male": 0.65 } }
    ],
    "predictions": { "kind": "classes", "rows": 321, "shares": [0.62, 0.38] },
    "performance": { "rows": 178, "accuracy": 0.82 }
  }
}
```

Elle contient des bornes de tranches, des parts et des effectifs, jamais une
ligne. Les colonnes sont profilées sur les lignes d'entraînement ; les réponses
sont lues sur les lignes que le modèle n'a pas vues à l'ajustement. Une
régression garde les tranches de ses valeurs prédites, son erreur quadratique
moyenne et la dispersion de ses erreurs au carré.

Une référence incomplète est **écartée, pas fatale** : le modèle se charge sans
elle, le panneau dit que le bloc n'a pas pu être lu, et un lot est alors
vérifié sur ses seules étiquettes. Les exports des formats 2 à 4 n'en portent
pas et se chargent comme avant.

### La politique de décision multiclasse

Un export peut porter une clé `decisionPolicy` facultative, un seuil par classe
dans l'ordre de `classes` :

```json
{ "decisionPolicy": { "thresholds": [0.5, 0.4, 0.6] } }
```

Elle n'est acceptée que si les quatre conditions tiennent : `formatVersion` vaut
4 ou 5, la tâche est une classification, `classes` compte plus de deux entrées, et
`thresholds` est un tableau de même longueur dont chaque valeur est un nombre
fini entre 0 et 1. Sinon l'import est refusé (`bad-manifest`) — une règle de
décision à moitié lisible est une règle de décision fausse.

Quand un modèle importé porte cette politique, le scoring d'un lot ajoute deux
colonnes au CSV de sortie : `policy_decision`, la classe retenue — **vide**
quand la règle s'abstient — et `decision_status`, qui vaut `decided` ou
`abstained`. Sans politique, ces colonnes n'apparaissent pas.

## Le profil de référence

Un profil de dérive stocke **des bins et des parts, jamais des lignes**. Le
profil d'un fichier de paie décrit la forme de la distribution des salaires et
le salaire de personne — c'est ce qui le rend sûr à committer à côté du code.

## Le contrat de données

Un contrat est un JSON exporté depuis le Data Studio, et relu par lui :

```json
{
  "format": "labml-data-contract/1",
  "source": "cafe-sales.csv",
  "createdAt": "2026-11-13T15:00:00.000Z",
  "rowCount": 118,
  "columns": [
    {
      "name": "quantity",
      "type": "numeric",
      "reading": "number",
      "missingRatio": 0.017,
      "profile": {
        "kind": "numeric",
        "column": "quantity",
        "missingRatio": 0.017,
        "mean": 2.55,
        "edges": [1, 2, 3, 4],
        "shares": [0.22, 0.28, 0.25, 0.17, 0.08]
      }
    }
  ],
  "rules": [
    {
      "kind": "validity",
      "rule": "negativeAmount",
      "columns": ["quantity"],
      "bound": { "min": 0 },
      "failures": 0,
      "tested": 116
    }
  ]
}
```

`reading` est ce que le contrat exige d'une colonne ; `type` est le type que le
labo a inféré, gardé pour le lecteur. `profile` est présent là où une
distribution veut dire quelque chose : une colonne numérique, catégorielle ou
booléenne. Chaque règle garde son nombre d'échecs à la référence, puisqu'une
règle qui y échouait déjà n'est pas rompue par le même taux.

Un fichier qui n'est pas un contrat entier est **refusé, pas appliqué en
partie** : un format inconnu, une colonne sans lecture, une règle inconnue, une
règle qui nomme une colonne que le contrat ne décrit pas. Une clause écartée en
silence serait une vérification sautée en silence.

## Les limites

| Limite           | Valeur                     | Pourquoi                                                                                              |
| ---------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Budget mémoire   | lignes × colonnes plafonné | la lecture s'arrête et le dit (`too-large`), plutôt que de faire tomber l'onglet, dans chaque section |
| Fichier servi    | 25 Mio                     | limite dure de Cloudflare Pages ; le modèle de langage est découpé pour la respecter                  |
| Classes de cible | 20 au plus                 | au-delà, la tâche n'est plus une classification exploitable                                           |

## Et ensuite ?

- [Scorer un nouveau lot](/docs/scorer-un-lot) — le format d'entrée le plus souvent en question.
- La [table des refus](/docs/refus) si un fichier a été refusé par son nom.
