---
slug: scorer-un-lot
kind: how-to
order: 1
title: Scorer un nouveau lot de données
summary: Vous avez un modèle entraîné et un fichier de lignes à prédire. Voici le geste, et ce que LabML vérifie avant d'accepter.
---

Suppose que vous avez déjà entraîné un modèle. Sinon, commencez par le
[tutoriel](/docs/premier-modele).

## Le geste

1. Sous le classement, ouvrez **Scorer un nouveau lot**.
2. Déposez le fichier — CSV, TSV ou Excel.
3. Les prédictions apparaissent ligne par ligne, exportables en CSV.

:::try /ml?demo=iris&target=species | Entraîner iris pour essayer avec iris-field.csv

## Ce que LabML vérifie avant d'accepter

Le fichier doit porter les colonnes que le modèle attend. S'il en manque,
LabML **refuse en les nommant** (`missing-columns`) plutôt que de prédire sur
des variables absentes.

Les colonnes supplémentaires sont ignorées sans bruit : un export de production
porte souvent des identifiants dont le modèle n'a jamais eu besoin.

## Si le fichier contient la vraie réponse

Alors LabML ne se contente pas de prédire : il compare, et affiche les mêmes
métriques que le classement.

C'est le geste de production le plus utile — vérifier qu'un modèle tient encore
sur des données qu'il n'a jamais vues. Un écart net avec le score de test est
un signal de dérive, à instruire dans le [Data Studio](/docs/reference-data).

## Les étiquettes jamais vues

Si votre lot contient une classe absente de l'entraînement, LabML la prédit
quand même mais l'**exclut des métriques**, en annonçant combien de lignes sont
concernées. Le modèle ne peut pas prédire une classe qu'il n'a jamais
rencontrée ; l'inclure dans la justesse serait la fausser.

## Et ensuite ?

- [Comparer deux runs](/docs/comparer-deux-runs) si le score a bougé.
- La [table des refus](/docs/refus) si le fichier a été refusé.
