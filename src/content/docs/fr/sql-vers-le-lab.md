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
