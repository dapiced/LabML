---
slug: sql-vers-le-lab
kind: how-to
order: 4
title: Passer un résultat SQL au ML Lab
summary: Filtrer, joindre ou agréger en SQL, puis entraîner sur le résultat — sans fichier intermédiaire.
---

## Le geste

1. Ouvrez le [Data Studio](/data) et chargez un fichier.
2. Dans la **console SQL**, écrivez votre requête. Le dataset actif est
   interrogeable par son nom, et vous pouvez attacher d'autres fichiers — CSV,
   Parquet ou JSON.
3. Une fois le résultat correct, cliquez sur **Envoyer au ML Lab**.

Le résultat devient le dataset actif du laboratoire. Rien n'est écrit sur
disque au passage.

:::try /data | Ouvrir le Data Studio

## Quand c'est le bon outil

- **Filtrer avant d'entraîner** : ne garder qu'une région, une période, un
  segment.
- **Joindre** plusieurs fichiers sur une clé, quand la jointure du Data Studio
  ne suffit pas.
- **Agréger** : passer d'une ligne par événement à une ligne par client, ce que
  la plupart des problèmes de ML réels demandent.

## Ce qui sort de la console

La console peint les 200 premières lignes pour rester fluide, et dit toujours
combien de lignes la requête a rendues. **Les exports sont la requête, pas
l'écran** : le CSV, le fichier Parquet et l'envoi au ML Lab sont écrits par le
moteur lui-même, et portent toutes les lignes.

- **Un NULL reste une valeur manquante.** Il part comme une cellule vide, que le
  labo lit comme manquante. Une colonne numérique avec des NULL arrive comme un
  nombre avec des trous.
- **Chaque requête a son propre nom de fichier**, par exemple
  `query-3f2a91c4.csv` : une empreinte de la requête, jamais son texte. Le
  registre du jeu de test du labo reconnaît un fichier à son nom et à sa forme,
  et deux requêtes de même forme ne doivent pas partager un seul compte.
- **Le budget de cellules du labo s'applique.** Un résultat de plus de
  20 millions de cellules (lignes fois colonnes) est refusé avant d'être
  construit, avec le conseil d'agréger ou de filtrer. C'est le même budget que
  pour la lecture d'un fichier.

Jusqu'à V69, les exports étaient construits à partir des lignes peintes : une
requête de 590 lignes en donnait 200 au labo, et un NULL arrivait sous la forme
de la marque que la console affiche pour lui, ce qui transformait une colonne
numérique en texte. Mesuré après la correction : les 590 lignes arrivent, et un
simple `SELECT *` sur chacune des six démos du labo redonne les mêmes lignes,
les mêmes colonnes et les mêmes types inférés que le fichier lui-même.

## Le coût, annoncé

Le moteur SQL est un téléchargement de 18 à 22 Mo, **optionnel**. Tant que vous
ne l'ouvrez pas, il n'est pas téléchargé. Il est mono-thread : LabML ne sert
pas les en-têtes qui débloqueraient le multi-thread.

C'est aussi pourquoi les vérifications de cohérence entre colonnes ne passent
**pas** par SQL : elles doivent marcher pour tout le monde, y compris ceux qui
n'ouvrent jamais la console.

## Et ensuite ?

- Le [tutoriel](/docs/premier-modele) pour entraîner sur le résultat.
- La [référence du Data Studio](/docs/reference-data) pour les formats acceptés.
