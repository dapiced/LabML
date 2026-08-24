---
slug: limites
kind: explanation
order: 1
title: Ce que LabML ne fait pas, et pourquoi
summary: Les fonctionnalités écartées, celles abandonnées après mesure, et les prédictions que la mesure a démenties.
---

Un projet qui nomme ses limites se lit comme un projet sérieux. Celui qui n'en
nomme aucune se lit comme un projet qui ne les a pas cherchées.

Cette page n'est pas écrite de mémoire. Elle est extraite du journal
d'ingénierie du dépôt (`PLAN.md`), où chaque vague enregistre ce qu'elle a
délibérément refusé de faire — parce qu'on se souvient volontiers des
renoncements élégants et beaucoup moins des embarrassants.

## Trois sortes de limites

Elles ne se valent pas, et les mélanger serait malhonnête :

1. **Un choix de conception** — c'était faisable, et faire autrement aurait
   dégradé quelque chose de plus important.
2. **Un renoncement mesuré** — on l'a construit ou chiffré, la mesure a dit
   non. Plus fort qu'un choix : on ne l'a pas seulement supposé.
3. **Une prédiction démentie** — le plan affirmait une chose, la mesure en a
   dit une autre, et c'est la mesure qui a gagné.

## Ce qui a été écarté par choix

| Écarté                                    | Pourquoi                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Un mode AutoML « on s'occupe de tout »    | L'exact contraire d'un laboratoire qui montre ses décisions                                                                   |
| Une dixième famille de modèles            | Neuf suffisent ; une dixième n'améliore ni l'honnêteté ni la compréhension                                                    |
| Le deep learning tabulaire                | Coût élevé, aucun gain à cette échelle, et ce ne serait plus écrit à la main                                                  |
| Un éditeur de cellules façon tableur      | Les retouches à la main cassent la reproductibilité — la recette est le seul enregistrement                                   |
| La déduplication floue                    | Faux positifs garantis sur des noms et des adresses : fusionner deux personnes réelles en silence                             |
| L'imputation par modèle                   | Opaque, et elle fabrique des valeurs plausibles — refusée deux fois, en V39 et en V40                                         |
| Cacher les modèles entre exécutions       | La clé de cache serait la configuration entière plus les données ; un hit périmé, c'est un classement faux sans avertissement |
| Deviner la locale d'un fichier            | Le navigateur n'a aucun rapport avec le fichier qu'on y dépose                                                                |
| Rendre l'indicateur d'absence obligatoire | Il ajouterait des colonnes à toute recette existante : imposer n'est pas annoncer                                             |

## Ce qui a été abandonné après mesure

**La réécriture du pipeline en tableaux typés** (V25). Elle était planifiée.
Puis on a mesuré : le pipeline n'a jamais été le goulot d'étranglement.

**Deux tirages et un vote pour le modèle de langage** (V30). Les deux critères
de départage sont morts en même temps que le décodage contraint : celui-ci
garantit que tout candidat valide, donc « garder celui qui valide » ne
discrimine plus rien.

**Un modèle de langage quatre fois plus gros** (V30). 1,43 Go, et il mesure
**pire** : 40 bonnes réponses contre 42, et 12 fausses contre 7. Il lit mieux
les questions difficiles et moins bien les faciles. « Plus gros » n'est pas une
direction de progrès ici ; c'est un échange dont le signe doit être mesuré.

**CLIP pour la vision** (~190 Mo, V31). Le défaut visé — le classifieur qui
nomme une personne — est couvert pour 0 Mo par un refus honnête. CLIP
répondrait à une **autre** question, et le banc ne peut pas l'arbitrer.

**Un meilleur détecteur d'objets** (YOLOX-S, ~35 Mo, V31). Celui-là, le banc
l'arbitre : les deux ratés du détecteur actuel sont inertes — les deux images
sont déjà nommées correctement.

## Des prédictions que la mesure a démenties

C'est la catégorie la plus utile, et la plus inconfortable.

- Le plan soupçonnait le **recadrage** de la vision d'écraser les photos. Le
  code ne les écrasait pas ; et l'écrasement plein cadre donne exactement le
  même score.
- Le plan annonçait « vous obtiendrez 0,821 » pour le tutoriel. Le vrai chiffre
  est **0,792**.
- Le plan écrivait 18,6 Mo pour les trois modèles de vision. Ils pèsent
  **18,5**, et c'est un test qui l'a signalé.
- L'ordre des deux interpréteurs du chat était inversé (V27.1), et la mesure
  l'a dit.

## Un descope n'est pas un abandon

La pondération de classes a été écartée par son nom en V16 — le seuil chiffré
par les coûts donnait le même contrôle au moment de décider. Elle a été
**livrée en V36**, avec deux mécanismes nommés par famille.

C'est ce qui distingue « pas fait » de « oublié » : un renoncement écrit reste
visible, et peut redevenir un travail.

## Et ensuite ?

- Le [tutoriel](/docs/premier-modele) si vous n'avez pas encore entraîné de modèle.
- La [table des refus](/docs/refus) pour ce que l'application refuse au cas par cas.
- Les [choix de méthode](/docs/methode) pour le pourquoi des décisions qui, elles, ont été prises.
