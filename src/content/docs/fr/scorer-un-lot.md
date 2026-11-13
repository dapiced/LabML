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

Le lot est lu comme le fichier d'entraînement l'a été, sous le même budget
mémoire. Un lot de plus de 20 millions de cellules est refusé (`too-large`)
plutôt que lu en entier.

## Si le fichier contient la vraie réponse

Alors LabML ne se contente pas de prédire : il compare, et affiche les mêmes
métriques que le classement.

C'est le geste de production le plus utile — vérifier qu'un modèle tient encore
sur des données qu'il n'a jamais vues. Savoir si un écart avec le score de test
est une vraie baisse ou le tirage d'un petit lot, c'est ce que tranche la
vérification en production ci-dessous.

## La vérification en production

Chaque lot scoré est comparé à ce sur quoi le modèle a été entraîné, et le
panneau rend un verdict avec ses trois signaux.

| Signal      | Question                                                         | Ce qu'il demande                 |
| ----------- | ---------------------------------------------------------------- | -------------------------------- |
| Colonnes    | les entrées ressemblent-elles encore aux lignes d'entraînement ? | rien de plus                     |
| Réponses    | le modèle répond-il encore comme avant ?                         | rien de plus                     |
| Performance | se trompe-t-il davantage ?                                       | la colonne cible dans le fichier |

| Verdict         | Quand                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Stable**      | rien ne se distingue du tirage                                                                                     |
| **Surveiller**  | des colonnes ou les réponses ont bougé, et la performance n'a pas mesurablement baissé, ou n'a pas pu être mesurée |
| **Réentraîner** | sur les lignes étiquetées, la baisse sort de son intervalle                                                        |

Deux règles, écrites sur le panneau :

- **une dérive est une raison de regarder, une baisse mesurée est une raison de
  réentraîner.** Sans étiquettes, le verdict s'arrête à « surveiller », et
  demande des étiquettes ;
- **une dérive ne compte que si elle se distingue du tirage.** Chaque PSI se
  lit contre son propre plafond de bruit : la valeur sous laquelle il reste,
  95 vérifications sur 100, quand le lot et la référence sont deux tirages des
  mêmes données à ces tailles. Les seuils fixes habituels (0,1 et 0,25) lisent
  un petit lot comme une dérive : sur les démos du labo, ils levaient une
  alerte forte sur 8 à 78 % des lots de 100 lignes où rien n'avait bougé, et
  sur presque tous ceux de 30 lignes.

Un modèle réimporté depuis un fichier porte sa référence avec lui (format 5).
Un export plus ancien n'en a pas : le panneau le dit, et vérifie le lot sur ses
seules étiquettes.

## Les colonnes de décision

Si le modèle scoré porte une règle de décision multiclasse — figée dans le
laboratoire, puis exportée avec lui —, le CSV produit gagne deux colonnes :

| Colonne           | Contenu                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `policy_decision` | La classe retenue par la règle, ou une cellule vide si la règle s'est abstenue. |
| `decision_status` | `decided` ou `abstained`.                                                       |

La colonne `predicted` reste la prédiction brute du modèle. Les deux colonnes
de décision ne la remplacent pas : elles disent ce que la règle a choisi d'en
faire. Une ligne en abstention est un dossier à router vers une revue humaine,
pas une erreur du modèle.

Sans règle attachée au modèle, ces colonnes n'apparaissent pas du tout.

## Les étiquettes jamais vues

Si votre lot contient une classe absente de l'entraînement, LabML la prédit
quand même mais l'**exclut des métriques**, en annonçant combien de lignes sont
concernées. Le modèle ne peut pas prédire une classe qu'il n'a jamais
rencontrée ; l'inclure dans la justesse serait la fausser.

## Et ensuite ?

- [Comparer deux runs](/docs/comparer-deux-runs) si le score a bougé.
- La [table des refus](/docs/refus) si le fichier a été refusé.
