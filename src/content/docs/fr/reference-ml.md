---
slug: reference-ml
kind: reference
order: 2
title: Référence — ML Lab
summary: Ce que fait chaque panneau du ML Lab, ce qu'il calcule exactement, et ce qu'il ne prétend pas faire.
---

À consulter, pas à lire. Un panneau par section, dans l'ordre où ils
apparaissent sous le classement.

:::try /ml?demo=titanic&target=survived | Ouvrir le ML Lab, titanic prêt

## Lecture du fichier

Le fichier est lu dans le navigateur. L'encodage est décidé **en essayant** :
UTF-8 en mode strict échoue sur des accents cp1252, donc le repli est une
certitude et non une préférence. Le délimiteur est le candidat qui découpe
chaque ligne échantillonnée en le même nombre de colonnes. Le séparateur
décimal est décidé **par colonne**, jamais par fichier, et une colonne n'est
réécrite que si au moins 90 % de ses valeurs sont des nombres sous cette forme.

La lecture est annoncée avec ses compteurs quand elle s'écarte du défaut. Un
fichier UTF-8 à virgules ne déclenche aucune carte : pas de friction pour le
cas ordinaire.

## Profil et choix de la cible

Chaque colonne reçoit un type inféré (numérique, catégorielle, booléenne,
texte, date), son nombre de valeurs distinctes, son taux de valeurs manquantes
et ses extrêmes. Choisir une cible déclenche la détection de tâche
(classification binaire, multiclasse, régression) et la **détection de fuite** :
une colonne qui reflète presque parfaitement la cible est exclue
automatiquement et nommée.

Pendant un entraînement, et pendant tout calcul qui en dépend (recherche
d'hyperparamètres, courbe d'apprentissage, classement robuste, scoring d'un
lot), la cible et les colonnes sont **verrouillées**. Les changer à ce
moment-là classerait les résultats sous une question à laquelle ils ne
répondent pas ; il faut attendre la fin ou annuler.

## Entraînement et classement

Huit familles écrites à la main, plus un ensemble, plus une baseline naïve.
Découpe **64 / 16 / 20** — entraînement, validation, test — seedée à 42.

Le gagnant est **élu sur la validation** ; le chiffre publié vient du **test**,
jamais touché pour choisir. L'écart entre les deux est affiché : c'est le prix
de la sélection, et le cacher rendrait le score flatteur.

La baseline répond toujours la classe majoritaire (ou la moyenne en
régression). Un modèle qui ne la dépasse pas n'a rien appris, quel que soit son
score absolu.

La découpe est stratifiée par classe. Une classe qui n'a **qu'une seule
ligne** reste du côté entraînement : l'envoyer au test laisserait les modèles
sans aucun exemple d'elle. Si toutes les classes n'ont qu'une ligne, il ne
reste rien à tester, et l'entraînement refuse avec `too-few-rows` plutôt que
de publier des métriques calculées sur un ensemble vide.

Précision, rappel et F1 sont des moyennes **macro**, calculées comme dans
scikit-learn : sur les classes présentes dans les vraies valeurs ou dans les
prédictions. Une classe absente des deux ne compte pas comme un zéro ; une
classe prédite mais jamais vraie compte, parce que ces prédictions sont toutes
fausses.

## Le journal du run

Certaines étapes d'un run sont facultatives : l'ensemble est optionnel, les
workers auxiliaires ne font que gagner du temps, une famille qui échoue sur un
pli du classement robuste rapporte quand même les autres. Quand l'une d'elles
renonce, le run reste utilisable et le **journal du run** dit ce qui s'est
passé, à côté du résultat concerné et dans le rapport HTML : quelle étape,
quelle famille, combien de fois, et l'erreur rencontrée.

Un run dont toutes les étapes ont réussi n'affiche aucun journal. Le journal
reste dans le run ; rien n'est envoyé nulle part.

## Solidité des chiffres

Le jeu de test est rééchantillonné 1 000 fois par bootstrap et la métrique
recalculée à chaque fois ; l'intervalle est l'endroit où elle atterrit 95 fois
sur 100. Les tirages sont **appariés** entre modèles, donc les comparaisons
sont légitimes. Ces intervalles mesurent la sensibilité au tirage du test —
**pas** la variance d'entraînement, et le panneau le dit.

Un intervalle large est une information, pas un défaut.

## Ce jeu de test a-t-il trop servi ?

Dans un run, la validation choisit le gagnant et le jeu de test ne fait que le
mesurer. Entre les runs, rien ne faisait respecter cette règle : entraîner,
lire le score de test, retirer une colonne, réentraîner, garder le meilleur des
deux, et c'est le jeu de test qui vient de choisir. Le score qui reste est le
plus chanceux.

Le **registre du jeu de test** compte, pour le fichier et la cible en cours,
combien de **configurations distinctes** le jeu de test actuel a notées. Une
configuration est un ensemble de colonnes, plus la pondération de classes.
Réentraîner la même ne compte pas : le labo est déterministe, les chiffres sont
les mêmes, et lire deux fois un chiffre ne choisit rien.

| Runs notés | Ce que dit le panneau                                                      |
| ---------- | -------------------------------------------------------------------------- |
| 1          | une mesure : rien n'a été choisi avec lui                                  |
| 2 à 4      | comparer, c'est déjà choisir ; l'effet reste faible                        |
| 5 à 9      | **usé** : lire le meilleur score comme optimiste                           |
| 10 et plus | **épuisé** : le jeu de test ne distingue plus le meilleur du plus chanceux |

Les deux seuils ont été mesurés, pas tirés d'une formule. Sur les trois démos,
un utilisateur qui garde le meilleur score de test de 5 configurations le voit
dépasser de 0,2 à 0,8 fois le bruit entre deux découpes ce que la même
configuration obtient sur une autre découpe, et jusqu'à ce bruit lui-même à
partir de 10. Sur titanic, cela fait +1,7 point d'exactitude à 5 runs. Plus les
configurations se valent vraiment, plus la meilleure n'est que la plus
chanceuse.

À partir du seuil « usé », le panneau propose une **nouvelle découpe** : la
graine suivante, un jeu de test que ce fichier n'a jamais eu. Entraînez une
seule fois la configuration retenue, et lisez ce score. Trois choses à savoir :

- une nouvelle découpe redistribue **les mêmes lignes**. Ce ne sont pas de
  nouvelles données, et le panneau compte les découpes déjà tirées ;
- la proposition attend le seuil « usé » à dessein : une découpe qu'on retire
  à volonté est une chose de plus avec laquelle chercher le bon chiffre ;
- une découpe **chronologique** n'a qu'un jeu de test, les lignes les plus
  récentes. Aucun autre tirage n'existe, et le panneau dit que seules des
  données plus récentes peuvent le remplacer.

Le registre est tenu dans ce navigateur, à part des runs : supprimer un run ne
dé-lit pas son jeu de test. Il garde une empreinte de chaque configuration,
jamais un nom de colonne ni une ligne. Le compte, tel qu'il était, rejoint le
run, son rapport et les limites de sa fiche de modèle.

## Le classement est-il réel ?

À la demande : 5 répétitions × 2 moitiés, dix ajustements par famille, avec
moyenne, dispersion, et la fréquence à laquelle le leader bat réellement le
second. Le jeu de test reste **hors** des plis : ceci reclasse, cela ne
re-teste pas.

## Recherche d'hyperparamètres

Recherche aléatoire seedée, jusqu'à 16 configurations, notées par validation
croisée 3 plis **sur l'entraînement seul**. Le test est scoré exactement une
fois, à la fin.

## Courbe d'apprentissage

Un modèle réentraîné sur des fractions croissantes et emboîtées de
l'entraînement, chacune scorée sur le même test complet, avec une bande
bootstrap. Si la courbe monte encore au bord droit, collecter plus de lignes
vaut le coup ; si elle est plate, travaillez les variables ou le modèle.

## Explications

- **Lecture en clair** : le score, l'écart à la baseline, le rappel, les
  colonnes décisives.
- **Matrice de confusion**, **courbe ROC**, **importance par permutation**
  (agnostique au modèle : la chute de justesse quand la colonne est mélangée).
- **Dépendance partielle** : la prédiction moyenne quand une colonne balaie sa
  plage, tout le reste inchangé.
- **What-if** : éditez les valeurs, la prédiction se recalcule localement.

## Ensembles de prédiction

Une prédiction est une réponse ; elle ne dit pas à quel point le modèle est sûr
de cette ligne. Le panneau des ensembles de prédiction fait répondre le modèle
par un **ensemble de classes** (« chat ou lynx »), ou par une **valeur avec une
marge** (« 42 ± 6 »), dimensionnés pour que la vérité tombe dedans au taux que
vous choisissez : 80, 90 ou 95 %. Une réponse large, c'est le modèle qui dit
qu'il ne sait pas trancher.

La méthode est la prédiction conforme par découpe. Sur des lignes que le modèle
n'a pas vues à l'ajustement, le laboratoire mesure à quel point il se trompe,
prend le quantile de ces erreurs au niveau demandé, et s'en sert comme seuil
pour toute nouvelle ligne.

Le laboratoire ne demande pas à être cru. Le seuil est calibré sur une moitié
du jeu de test et **mesuré sur l'autre**, dans les deux sens, et la couverture
mesurée est affichée à côté de la cible avec son intervalle. Le jeu de
validation n'est pas utilisé : il a choisi le modèle gagnant, ce qui fait
paraître ses erreurs plus petites qu'elles ne sont.

Trois limites, écrites aussi dans le panneau :

- la promesse est une **moyenne** sur des lignes comme celles-ci, pas une
  promesse pour chaque classe, chaque segment ou chaque ligne ;
- elle cesse de tenir quand les nouvelles données dérivent de celles du run ;
- en régression, la marge est la même pour toutes les lignes.

Quand le jeu de test est trop petit pour le niveau demandé (95 % exige 19
lignes par moitié), aucun seuil n'est donné et le panneau dit combien de lignes
manquent.

## Seuil de décision

Courbe précision-rappel, courbe de calibration, et un seuil que **vous**
décidez, chiffré par vos coûts de faux positif et de cas manqué. Une
probabilité n'est pas une décision ; le seuil est enregistré avec le run.

La suggestion « optimal pour ces coûts » est choisie sur le jeu de
**validation**, et les chiffres affichés à côté sont mesurés sur le jeu de
test, qui n'a pas participé au choix. Un seuil choisi sur le jeu de test lui
serait ajusté, et ses métriques cesseraient d'être une mesure. Quand un run n'a
pas de jeu de validation contenant les deux classes, aucun seuil n'est suggéré
et le panneau dit pourquoi.

## Décider en multiclasse

Au-delà de deux classes, un seul curseur ne suffit plus. Le panneau de décision
multiclasse donne **un seuil par classe**, et une règle énoncée : une classe est
candidate si sa probabilité atteint son seuil ; entre plusieurs candidates, celle
dont l'excédent normalisé est le plus grand l'emporte ; les égalités sont
tranchées par l'ordre des classes, toujours le même.

Quand aucune classe n'atteint son seuil, la règle **s'abstient** et le dit. Elle
ne retombe pas en silence sur la classe la plus probable — c'est précisément ce
qu'un seuil sert à empêcher. Mettre tous les seuils à zéro reproduit exactement
l'argmax, avec une couverture totale : la règle par défaut ne change rien tant
que vous n'avez rien demandé.

Deux justesses sont affichées côte à côte : la justesse globale, où une
abstention compte comme une erreur, et la justesse conditionnelle aux lignes
décidées. La première répond à « que vaut le système », la seconde à « que vaut
la règle quand elle se prononce ».

L'éditeur travaille sur la **partition de validation**, jamais sur le test. Vous
figez la règle avant de révéler le résultat de test ; la modifier après cette
révélation marque le résultat comme exploratoire plutôt que de laisser croire
qu'il a été obtenu à l'aveugle. Sans partition de validation — un dataset trop
petit, par exemple — le panneau explique pourquoi il ne s'affiche pas.

## Où le modèle échoue

Le test est découpé par chaque colonne catégorielle — **y compris celles hors
des variables**, où des effets de proxy peuvent se cacher. Les tranches de
moins de 8 lignes sont exclues. Un écart est une piste à examiner, pas un
verdict.

## Le modèle traite-t-il les groupes différemment ?

L'analyse par segments regarde toutes les colonnes et cherche où le modèle est
le plus faible. L'**audit par groupe** pose une autre question, sur **une
colonne que vous désignez** : un modèle peut être exact à 80 % partout et dire
pourtant « oui » à la plupart d'un groupe et à peu d'un autre, ou rater plus de
cas réels chez l'un.

Pour une cible binaire, chaque groupe reçoit trois taux, chacun avec un
intervalle :

- **a dit « oui »** : la part prédite positive (l'écart entre groupes est la
  parité démographique) ;
- **cas réels retrouvés** : la part des vrais positifs retrouvés (égalité des
  chances) ;
- **fausses alertes** : la part des vrais négatifs signalés.

Chaque écart est lu par rapport au groupe le plus nombreux et porte son propre
intervalle. Quand l'intervalle contient zéro, l'écart est dans le bruit. Ce
n'est **pas** une preuve de traitement égal : avec peu de lignes, seul un écart
important se verrait, et le panneau le dit. Une cible multiclasse reçoit la
part de réponses correctes par groupe ; une régression, l'erreur moyenne,
signée et absolue.

Trois règles, écrites dans le panneau :

- **le laboratoire ne décide pas quelle colonne est sensible** : vous la
  désignez, et rien ne tourne avant. Une colonne écartée des variables peut être
  auditée aussi : un modèle peut l'atteindre par d'autres colonnes qui la
  remplacent ;
- **un écart est un constat, pas un verdict** : aucun seuil légal n'est
  appliqué et rien n'est corrigé ;
- **un groupe trop petit n'est pas comparé** : sous 20 lignes de test il est
  listé avec son effectif, et un taux reposant sur moins de 10 cas n'est pas
  calculé.

La décision auditée est celle que vous avez réglée : le seuil choisi dans le
panneau de décision s'il y en a un, la réponse du modèle sinon.

## La fiche de modèle

Le rapport de run est un compte rendu technique pour celui qui a entraîné le
modèle. La **fiche de modèle** s'adresse à celui qui doit décider de s'en servir
ou de l'approuver : à quoi le modèle sert, sur quoi il a été construit, ce qu'il
vaut, où il échoue, et ce qui n'a jamais été vérifié. Elle se télécharge en HTML
ou en Markdown, depuis le run à l'écran comme depuis un run enregistré ou
partagé.

Deux règles la gouvernent :

- **Rien n'est inventé.** L'usage prévu, ce pour quoi le modèle ne doit pas
  servir et qui en répond sont saisis par vous. Laissés vides, la fiche écrit
  « non renseigné » et annonce en tête qu'elle est incomplète. Elle ne devine
  pas un usage.
- **Ce qui n'a pas été évalué est listé.** Une analyse que personne n'a lancée
  (le classement robuste, les segments, les ensembles de prédiction…) apparaît
  sous « Non évalué » au lieu de disparaître. Un audit par groupe jamais lancé
  y figure aussi : une fiche muette se lirait comme « vérifié, rien trouvé ».

Les analyses rattachées à un run décrivent le modèle qui était inspecté quand
elles ont été calculées, qui n'est pas toujours le gagnant. Chaque section
nomme son modèle et le dit quand ce n'est pas celui de la fiche.

La fiche ne contient que des chiffres, jamais une ligne des données. Ce que
vous saisissez est conservé avec le run dans votre navigateur et voyage dans son
lien de partage.

## Rejouer une ligne

Le panneau « Et si… » peut **rejouer** sa ligne à travers le modèle inspecté :
les questions posées par un arbre de décision, le décompte des arbres d'une
forêt, les cinq lignes auxquelles un k-NN l'a comparée, la prédiction qu'un
boosting construit tour après tour. Le rejeu parcourt le modèle lui-même : sa
dernière étape est la prédiction affichée, et ses questions sont écrites dans
les unités du fichier. Voir
[rejouer une prédiction](/docs/rejouer-une-prediction).

## Exporter, importer, scorer

Le modèle s'exporte en JSON avec son manifeste : famille, pipeline, versions.
Il se réimporte dans une session vierge et score un CSV. Une règle de décision
multiclasse figée voyage avec l'export, et le CSV scoré porte alors deux
colonnes de plus — voir [la page des formats](/docs/formats). Les cinq raisons
de refus à l'import sont nommées — voir la [page des refus](/docs/refus).

Depuis le format 5, l'export porte aussi une **référence de production** : des
parts et des effectifs qui décrivent les colonnes et les réponses du modèle,
jamais une ligne. Chaque lot scoré ensuite, par le run en cours ou par le
fichier réimporté, reçoit une **vérification en production** : un verdict
(stable, surveiller, réentraîner) à partir de trois signaux, les colonnes, les
réponses, et la performance quand le fichier porte des étiquettes. Une dérive
ne compte qu'au-dessus de son propre plafond de bruit, et seule une baisse
mesurée dit « réentraîner ». Voir [scorer un lot](/docs/scorer-un-lot).

Un fichier scoré sans étiquette peut repartir en **fichier de soumission** pour
une compétition : un identifiant et une prédiction sous les noms que vous
donnez, toutes les lignes gardées dans leur ordre. Le modèle mesuré prédit par
défaut ; la même famille réentraînée sur toutes les lignes étiquetées est
proposée, et annoncée comme un modèle que personne n'a mesuré. Voir
[scorer un lot](/docs/scorer-un-lot).

Un lien de partage transporte les métriques et les graphiques du run dans le
fragment d'URL, jamais les données. Un lien coupé ou abîmé ne donne jamais une
page à moitié lue : s'il ne se décode pas, ou si une partie du run qu'il porte
n'a pas la forme qu'écrit LabML, la page refuse de l'afficher et dit
pourquoi.

## Comparer des runs

Deux runs côte à côte (`/ml/compare/:a/:b`) ou jusqu'à six
(`/ml/compare-many/:ids`) : configuration, variables ajoutées ou retirées,
classement par modèle, incertitude croisée.

## Et ensuite ?

- [Scorer un nouveau lot](/docs/scorer-un-lot), [comparer deux runs](/docs/comparer-deux-runs), [lire une courbe](/docs/lire-une-courbe) — les gestes, un par page.
- [Les choix de méthode](/docs/methode) — pourquoi la baseline, les intervalles et la graine 42.
