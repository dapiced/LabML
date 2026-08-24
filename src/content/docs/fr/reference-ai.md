---
slug: reference-ai
kind: reference
order: 4
title: Référence — Vision et assistant
summary: Les trois réseaux de la vision, les deux interpréteurs de l'assistant, et ce que chacun refuse de faire.
---

## Vision

:::try /ai/vision | Ouvrir le terrain de jeu vision

Trois modèles auto-hébergés, **18,5 Mo au total**, exécutés par ONNX Runtime
Web en WebAssembly, mono-thread. L'image ne quitte jamais l'onglet.

| Modèle                  | Taille  | Rôle                                              |
| ----------------------- | ------- | ------------------------------------------------- |
| EfficientNet-Lite4 int8 | 13,6 Mo | classification sur les 1 000 classes ImageNet-1k  |
| YOLOX-Nano              | 3,7 Mo  | détection d'objets sur les 80 classes COCO        |
| UltraFace RFB-320       | 1,3 Mo  | localisation de visages — jamais d'identification |

Préparation : recadrage centré 224² pour le classifieur, letterbox gris 416²
pour YOLOX (ordre BGR, valeurs brutes 0–255), letterbox 320×240 pour UltraFace.
Le décodage des boîtes — grilles, IoU, suppression non-maximale — est écrit à
la main et testé unitairement.

Seuils : **0,35** pour les objets, **0,90** pour les visages.

### Le verdict honnête

ImageNet-1k a 1 000 étiquettes, 118 races de chien, et **aucune pour un être
humain**. Un softmax ne peut pas s'abstenir. Le refus vient donc de l'extérieur
du classifieur, par deux règles :

1. **Sujet humain** — le détecteur d'objets trouve une personne **et** le
   détecteur de visages trouve un visage. Exiger les deux est mesuré : YOLOX
   dessine « person » sur une bouteille de vin et sur une voiture de sport, et
   UltraFace ne trouve aucun visage sur ni l'une ni l'autre.
2. **Plancher de confiance à 50 %** — sous ce seuil, les premières classes sont
   quasi à égalité.

La règle 1 l'emporte sur la 2. L'étiquette n'est jamais cachée, seulement
encadrée.

## Assistant de données

:::try /ai/chat | Ouvrir l'assistant

Deux interpréteurs, **dans cet ordre** : le déterministe d'abord, le modèle de
langage seulement sur ce qu'il refuse.

### L'interpréteur déterministe

Un parseur FR/EN sur lexiques, qui produit une requête typée exécutée par le
moteur V6. Il calcule exactement : moyenne, médiane, min/max, somme, comptage
sous condition, top N, groupement, corrélation, forme du tableau.

**Il vérifie sa propre couverture.** Chaque mot de la question doit être
justifié par une phrase de lexique, une colonne utilisée, une valeur filtrée,
ou l'une de trois listes fermées (mobilier du tableau, noms de lignes
génériques, mots de liaison). Un mot resté inexpliqué déclenche un refus.

C'est ce qui a corrigé le défaut le plus coûteux mesuré : « combien de
femmes ? » répondait 891 au lieu de 314 — la grammaire connaissait
« combien », ignorait « femmes », gardait le comptage et jetait la condition.
Le compromis est à sens unique : un mot inconnu peut coûter un refus là où une
réponse était possible, jamais une réponse fausse là où un refus était juste.

### Le modèle de langage local

Qwen3-0.6B-DQ q4f16, Apache-2.0, **355 Mo**, téléchargé sur consentement
explicite avec le poids annoncé, découpé en morceaux < 25 Mio et recollé dans
le navigateur avec vérification d'intégrité.

**Le modèle n'a jamais le droit de calculer.** Il traduit la question en
requête ; tous les nombres viennent du moteur déterministe.

Le décodage est **contraint** par un automate sur la grammaire de requêtes,
qui masque à chaque jeton tout ce qui en sortirait. Il marche sur les **octets**
UTF-8 et non sur les caractères : le vocabulaire est du BPE au niveau octet, et
1 457 de ses 151 669 jetons sont des fragments de caractère — un automate au
niveau caractère aurait rendu « Île-de-France » inécrivable comme valeur de
filtre.

La grammaire garde `{"kind":"none"}` atteignable : une forme dont le seul sens
est « je ne peux pas exprimer ça ». Sans elle, contraindre la sortie transforme
les refus en erreurs confiantes — mesuré : +7 réponses fausses.

### Ce que mesure le banc

55 questions de référence, FR et EN, rejouées contre les poids réels. L'app est
passée de **33 justes / 15 fausses** à **42 justes / 7 fausses**, pour 0 Mo. Un
modèle quatre fois plus gros (1,43 Go) a mesuré **pire** : 40 justes / 12
fausses.

## Et ensuite ?

- [Ce que LabML ne fait pas](/docs/limites) — pourquoi CLIP et un meilleur détecteur ont été écartés, chiffres à l'appui.
- La [table des refus](/docs/refus) pour décoder un message précis.
