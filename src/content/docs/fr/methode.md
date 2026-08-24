---
slug: methode
kind: explanation
order: 2
title: Les choix de méthode, et pourquoi
summary: Pourquoi une baseline avant tout, pourquoi des intervalles plutôt qu'un chiffre, pourquoi la graine 42 partout, et pourquoi tout s'exécute localement.
---

Cette page ne dit pas comment faire quelque chose — elle dit pourquoi LabML le
fait ainsi. Si vous cherchez une tâche, allez plutôt aux
[guides pratiques](/docs/scorer-un-lot).

## Pourquoi une baseline avant toute chose

Un score absolu ne veut rien dire. Sur titanic, la classe majoritaire occupe
62 % des lignes : un modèle qui répond toujours « n'a pas survécu » obtient
**61,8 %** sans avoir rien appris.

C'est pourquoi la baseline naïve est entraînée, classée et affichée comme les
autres, en dernière ligne. Elle n'est pas décorative : elle est le **mètre**.
Un modèle à 79,2 % n'est pas « bon à 79 % », il est **17,4 points au-dessus de
ce que coûte zéro apprentissage**. C'est ce nombre-là qui dit si l'entraînement
a servi à quelque chose.

Sans elle, un jeu de données déséquilibré produit des scores flatteurs qu'on
publie de bonne foi.

## Pourquoi des intervalles plutôt qu'un seul chiffre

Le jeu de test de titanic fait 178 lignes. Une justesse de 0,792 sur 178 lignes
n'est pas 0,792 : c'est un tirage. Un autre échantillon de 178 personnes aurait
donné autre chose.

LabML rééchantillonne donc le test 1 000 fois et recalcule la métrique à chaque
fois. L'intervalle affiché est l'endroit où elle atterrit 95 fois sur 100.

**Un intervalle large est une information, pas un défaut.** Il dit : sur si peu
de lignes, ce chiffre est mou. Deux modèles dont les intervalles se recouvrent
largement ne sont pas départagés par leur différence de score — et le panneau
le dit en toutes lettres plutôt que de laisser croire à une hiérarchie.

Les tirages sont **appariés** entre modèles : le même rééchantillonnage sert à
tous, donc les comparaisons portent sur les mêmes lignes.

Une limite, énoncée plutôt qu'enterrée : ces intervalles mesurent la
sensibilité **au tirage du test**, pas la variance d'entraînement. Réentraîner
sur un autre découpage donnerait une autre source de variation, que le panneau
ne mesure pas.

## Pourquoi la graine 42, partout

Tout ce qui tire au hasard dans LabML — le découpage, l'initialisation, les
sous-échantillons, la recherche d'hyperparamètres, le bootstrap, la forêt
d'isolation — part de la même graine fixe.

Ça n'est pas un détail de confort. C'est ce qui rend possible tout le reste :

- **Vous obtenez les chiffres de la documentation.** Le tutoriel annonce 0,792
  et un test le vérifie à chaque construction. Sans graine fixe, cette phrase
  serait invérifiable.
- **Deux runs sont comparables.** La page de comparaison peut attribuer un
  écart à ce que vous avez changé, et non au hasard.
- **Un modèle exporté se rejoue.** La recette et le manifeste suffisent à
  reproduire le résultat.

Le prix est réel et il faut le dire : un seul tirage n'est pas une étude de
variance. C'est exactement pour ça que les intervalles existent, et que le
classement 5×2 est proposé quand on veut savoir si l'ordre tient.

## Pourquoi tout s'exécute localement

Votre fichier ne part pas. Ce n'est pas une politique de confidentialité, c'est
une propriété de l'architecture : il n'y a pas de serveur qui pourrait le
recevoir.

La page [/privacy](/privacy) détaille ce qui traverse le réseau et ce qui ne le
traverse pas, avec de quoi le vérifier vous-même dans l'onglet Réseau — cette
page n'en répète pas le contenu, parce que deux textes sur le même sujet
divergent tôt ou tard, et c'est celui qu'on oublie de corriger qui reste.

Ce qui vaut d'être dit ici, ce sont les **conséquences** de ce choix, parce
qu'elles se lisent partout dans le produit :

- Les modèles sont auto-hébergés et leur poids est annoncé avant tout
  téléchargement — 18,5 Mo pour la vision, 355 Mo pour le modèle de langage,
  sur consentement explicite.
- Le moteur SQL est mono-thread : LabML ne sert pas les en-têtes COOP/COEP qui
  débloqueraient le multi-thread, parce qu'ils casseraient d'autres choses.
- Une garde mémoire nommée arrête la lecture d'un fichier trop gros et le dit,
  plutôt que de faire tomber l'onglet.
- Les modèles sont écrits à la main : rien n'appelle une bibliothèque distante.

## Et ensuite ?

- [Ce que LabML ne fait pas](/docs/limites) — les limites, et pourquoi.
- [Lire une courbe d'apprentissage](/docs/lire-une-courbe) — la méthode appliquée à une question précise.
- La [référence du ML Lab](/docs/reference-ml) pour le détail de chaque panneau.
