---
slug: premier-modele
kind: tutorial
order: 1
title: Votre premier modèle en 10 minutes
summary: De la page vide à un modèle entraîné, évalué honnêtement et lisible — sans rien envoyer nulle part.
---

Ce tutoriel vous fait entraîner un vrai modèle sur un vrai jeu de données, puis
**lire son résultat sans vous mentir**. Il ne propose aucun choix : suivez-le
tel quel et vous obtiendrez exactement les chiffres écrits ici. Vous
comparerez, et si un chiffre diffère, c'est LabML qui a un problème, pas vous.

Comptez dix minutes. Tout se passe dans votre navigateur : aucune donnée ne
part, aucun compte n'est demandé.

## Charger le jeu de données

Ouvrez le ML Lab et cliquez sur la démo **titanic.csv**. Ce lien le fait pour
vous :

:::try /ml?demo=titanic | Ouvrir le ML Lab avec titanic.csv chargé

Sous le nom du fichier, LabML affiche ce qu'il a lu :

> 891 lignes · 15 colonnes

Le fichier a été lu **sur place**. Ouvrez l'onglet Réseau de votre navigateur
et rechargez : vous ne verrez aucune requête transportant vos données.

## Choisir la colonne à prédire

Dans **Colonne à prédire**, choisissez `survived`.

Trois choses apparaissent immédiatement, et chacune mérite un regard.

D'abord la nature de la tâche : **Classification binaire**. LabML l'a déduite
de la colonne — deux valeurs distinctes, donc deux classes.

Ensuite, un avertissement :

> Fuite de cible : `alive` reflète presque parfaitement la cible — exclue
> automatiquement.

C'est le genre de détail qui fait la différence entre un modèle et une
illusion. La colonne `alive` dit « yes » exactement quand `survived` vaut 1 :
un modèle qui la voit obtient un score quasi parfait et n'a **rien appris**.
LabML l'écarte et vous le dit, plutôt que de vous laisser publier 99 %.

Enfin, un avertissement sur l'équilibre des classes : la classe majoritaire
occupe 62 % des lignes d'entraînement. Retenez-le, il servira à la fin.

## Entraîner

Cliquez sur **Entraîner**. Plusieurs familles de modèles sont entraînées en
parallèle, dans des workers, sur votre machine.

Sous le classement, LabML annonce le protocole :

> seed 42 · 570 lignes d'entraînement · 143 lignes de validation ·
> 178 lignes de test · 30 variables après encodage

**Trois découpes, pas deux**, et c'est délibéré. L'entraînement sert à
apprendre ; la validation sert à choisir le gagnant ; le test n'est touché
qu'une seule fois, à la fin. La graine 42 est fixe : relancez, vous obtiendrez
les mêmes chiffres.

## Lire le classement

Voici ce que vous devez voir, dans cet ordre :

| #   | Modèle                 | Justesse (val) | Test      |
| --- | ---------------------- | -------------- | --------- |
| 1   | k plus proches voisins | **0.818**      | 0.792     |
| 2   | Ensemble (top 3)       | 0.790          | 0.815     |
| 3   | Gradient boosting      | 0.790          | 0.820     |
| 4   | Régression logistique  | 0.790          | 0.820     |
| 5   | Arbre de décision      | 0.790          | **0.831** |
| 9   | Baseline naïve         | 0.615          | 0.618     |

Arrêtez-vous une seconde sur ce tableau, parce qu'il contient le point le plus
important du tutoriel.

## Le gagnant n'est pas le meilleur — et c'est normal

Le champion élu est **k plus proches voisins**, à 0.818 sur la validation. Mais
sur le jeu de test, il fait **0.792** — et l'arbre de décision fait 0.831,
mieux que lui.

Ce n'est pas un bug. C'est ce que LabML vous dit sous le classement :

> k plus proches voisins a été sélectionné sur la validation à 0.818 et obtient
> 0.792 sur le jeu de test jamais touché (-0.026).

Choisir le meilleur parmi plusieurs modèles **sur une découpe rend cette
découpe optimiste** : à force de regarder la validation pour élire un gagnant,
on finit par choisir celui qui a eu de la chance dessus. Le seul chiffre encore
honnête est celui de la troisième découpe, jamais utilisée pour choisir.

Beaucoup d'outils vous montreraient 0.831 en gros. Le chiffre à retenir ici est
**0.792**, et l'écart de -0.026 est le prix de la sélection, affiché plutôt que
caché.

## Lire le résultat en clair

Sous le classement, la **lecture en clair** traduit :

> k plus proches voisins classe correctement 79.2 % des 178 lignes de test.
> C'est 17.4 points au-dessus de la baseline naïve (61.8 %), donc le modèle a
> appris un vrai signal. Il attrape 72.1 % des cas « 1 » réels. Les colonnes
> les plus décisives sont : sibsp, pclass, sex.

La baseline naïve répond toujours la classe majoritaire. À 61.8 %, elle est le
mètre-étalon : un modèle qui ne la dépasse pas n'a rien appris, quel que soit
son score absolu. Les 17.4 points d'écart sont la seule preuve que
l'entraînement a servi à quelque chose.

Souvenez-vous de l'avertissement sur l'équilibre des classes : avec 62 % d'une
seule classe, la justesse flatte. C'est pourquoi la lecture cite aussi le
rappel — 72.1 % des cas positifs réellement attrapés.

## Ce que vous avez fait

Vous avez chargé un fichier lu localement, écarté une fuite de cible signalée
automatiquement, entraîné plusieurs familles sur trois découpes seedées, et lu
un score sur un jeu de test jamais utilisé pour choisir. C'est le protocole
complet, pas une démonstration simplifiée.

Rien de tout cela n'a quitté votre navigateur.

## Et ensuite

Cliquez sur n'importe quelle ligne du classement pour inspecter un autre modèle
que le champion. Les panneaux sous le classement répondent chacun à une
question précise : la solidité des chiffres, la réalité du classement, le seuil
de décision, et les endroits où le modèle échoue.
