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

| Format  | Contenu                                                                         |
| ------- | ------------------------------------------------------------------------------- |
| CSV     | dataset nettoyé, prédictions d'un lot, résultat SQL                             |
| Parquet | résultat SQL, via `COPY … TO`                                                   |
| JSON    | modèle entraîné avec son manifeste ; recette de nettoyage ; profil de référence |
| HTML    | rapport de run, autonome et lisible hors ligne                                  |

## Le manifeste de modèle

Un export de modèle est un JSON qui se réimporte dans une session vierge. Il
contient la famille, ses paramètres appris, le pipeline complet (encodages,
échelles, vocabulaire TF-IDF le cas échéant) et un manifeste :

```json
{
  "labml": true,
  "version": 3,
  "kind": "logistic",
  "task": "binary",
  "features": ["pclass", "sex", "age"],
  "target": "survived",
  "seed": 42
}
```

`labml` et `version` sont vérifiés avant toute autre chose : un JSON qui n'est
pas un export LabML est refusé par son nom (`not-labml`), pas par un plantage.
Un manifeste incomplet est refusé (`bad-manifest`) plutôt que complété par des
suppositions — un export auquel on ne peut pas se fier pour prédire ne doit pas
prédire.

## Le profil de référence

Un profil de dérive stocke **des bins et des parts, jamais des lignes**. Le
profil d'un fichier de paie décrit la forme de la distribution des salaires et
le salaire de personne — c'est ce qui le rend sûr à committer à côté du code.

## Les limites

| Limite           | Valeur                     | Pourquoi                                                                             |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------ |
| Budget mémoire   | lignes × colonnes plafonné | la lecture s'arrête et le dit (`too-large`), plutôt que de faire tomber l'onglet     |
| Fichier servi    | 25 Mio                     | limite dure de Cloudflare Pages ; le modèle de langage est découpé pour la respecter |
| Classes de cible | 20 au plus                 | au-delà, la tâche n'est plus une classification exploitable                          |
