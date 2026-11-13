---
slug: refaire-en-python
kind: how-to
order: 5
title: Refaire une exécution en Python
summary: Vous avez entraîné dans le navigateur et voulez la même exécution dans un notebook. Voici le script que LabML écrit, ce qu'il reprend à l'identique, et ce qu'il ne fait que traduire.
---

On suppose que vous avez une exécution terminée. Sinon, commencez par le
[tutoriel](/docs/premier-modele).

## Le geste

1. Sous le classement, cliquez sur **Script Python (scikit-learn)**.
2. Placez le script à côté du fichier sur lequel l'exécution a été faite.
3. Lancez-le.

```bash
python labml-titanic.py --data titanic.csv
```

Il demande pandas et scikit-learn. Il affiche une ligne par modèle : la métrique
de test de LabML, la sienne, et l'écart.

:::try /ml?demo=titanic&target=survived | Entraîner titanic, puis exporter le script

## Ce qui est repris à l'identique

- **Les lignes de chaque découpe.** Le script contient les numéros de ligne des
  jeux d'entraînement, de validation et de test. Pas une graine censée redonner
  la même découpe : la découpe elle-même.
- **Le prétraitement.** Un transformateur par colonne, dans l'ordre de LabML :
  un nombre est standardisé sur les valeurs présentes, puis une valeur manquante
  devient la médiane ; un libellé devient une colonne par catégorie, ou son rang
  quand il y en a trop ; le texte libre passe par le vocabulaire de LabML.

Mesuré sur six démos et cinq graines chacune : la matrice que le script encode à
partir des lignes d'entraînement est égale à celle de LabML à 2,9e-14 près.

## Ce qui est traduit

Les modèles. Les estimateurs de LabML sont écrits à la main ou viennent de
ml.js ; le script utilise l'estimateur scikit-learn le plus proche, avec les
réglages de LabML. Chaque ligne qu'il affiche dit de quel cas il s'agit.

| Relation                                                | Familles                                              | Ce qui a été mesuré                                                 |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| même algorithme                                         | référence naïve, régression linéaire, Bayes naïf      | la même métrique de test sur chaque exécution                       |
| même algorithme, distances égales départagées autrement | k-NN                                                  | la même métrique sur quatre démos sur six                           |
| même famille, autre implémentation                      | régression logistique, arbre, forêt, boosting, réseau | un petit écart en moyenne, plusieurs lignes de test sur une découpe |

Le script **ne promet donc pas les chiffres de LabML**. Il les remesure et
montre les deux. Un écart n'est une erreur d'aucun des deux côtés : c'est ce qui
sépare deux implémentations d'une même idée. Sur un jeu de test de 30 lignes,
une ligne vaut 3,3 points d'exactitude.

Le relevé complet, famille par famille, est dans
`tests/golden/python-bridge.md`.

## Ce que le script vérifie avant de tourner

Il refuse un fichier qui n'est pas celui de l'exécution : un autre nombre de
lignes ou de colonnes l'arrête avec un message, puisque les numéros de ligne
désigneraient alors d'autres lignes.

```bash
python labml-titanic.py --check
```

`--check` lit l'exécution et affiche ce qu'elle contient, sans aucune
bibliothèque installée.

## Ce qui n'est pas refait

- L'**ensemble** d'une exécution : il est nommé comme non refait.
- La recherche d'hyperparamètres, la courbe d'apprentissage, l'audit par groupe,
  la vérification en production : le script refait l'entraînement et son
  évaluation.
- Une exécution lue depuis un **tableur** : enregistrez d'abord la feuille en
  CSV. Le script le dit en démarrant.

Le script contient des noms de colonnes, des numéros de ligne, des réglages et
les métriques de LabML. Aucune valeur d'aucune ligne n'y figure : les données
restent où elles sont.

## Et ensuite ?

- [Les formats](/docs/formats) pour ce que LabML lit et écrit.
- [Les limites](/docs/limites) pour ce qui a été écarté, et pourquoi.
