---
slug: comparer-deux-runs
kind: how-to
order: 2
title: Comparer deux exécutions
summary: Vous avez changé quelque chose et voulez savoir ce que ça a coûté ou rapporté. Voici comment attribuer l'écart.
---

## Le geste

1. Entraînez une première fois. Le run est enregistré dans l'historique, en bas
   du ML Lab.
2. Changez **une seule chose** — retirez une colonne, changez le découpage,
   activez la pondération de classes.
3. Réentraînez.
4. Dans l'historique, sélectionnez les deux runs et ouvrez **Comparer**.

Jusqu'à six runs peuvent être comparés d'un coup.

## Ce que la page vous donne

- **La configuration** des deux côtés, avec ce qui diffère mis en évidence.
- **Les variables** ajoutées et retirées, nommées.
- **Le classement par modèle** : chaque famille, son score des deux côtés, et
  l'écart.
- **L'incertitude croisée** : l'écart survit-il au rééchantillonnage, ou tient-il
  dans le bruit ?

Cette dernière ligne est celle qui compte. Un écart de +0,01 sur 178 lignes de
test n'est pas un gain — c'est un tirage.

## Pourquoi changer une seule chose

Parce que la graine est fixe, tout ce qui reste identique **reste identique**.
Si vous ne changez qu'une variable, l'écart lui est attribuable.

Si vous en changez trois, la page vous montrera fidèlement un écart que vous ne
saurez pas répartir. LabML ne peut pas démêler ça pour vous.

## Et ensuite ?

- [Lire une courbe d'apprentissage](/docs/lire-une-courbe) si la question est « plus de données aideraient-elles ? ».
- [Les choix de méthode](/docs/methode) sur pourquoi l'incertitude est affichée plutôt que cachée.
