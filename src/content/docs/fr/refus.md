---
slug: refus
kind: reference
order: 1
title: Tous les refus, et quoi en faire
summary: Chaque refus nommé que LabML peut opposer — ce qui le déclenche, ce qu'il signifie, et le geste qui débloque.
---

LabML préfère refuser que répondre approximativement. C'est un choix, pas une
panne — mais un refus qu'on ne sait pas décoder se lit comme un bug. Cette page
existe pour ça.

**Cette liste n'est pas écrite de mémoire.** Elle est extraite du code source,
et un test la ré-extrait à chaque exécution : un code levé mais absent d'ici
fait échouer la construction, et un code listé ici que le code ne lève plus
aussi. Elle ne peut donc pas dériver en silence.

## Comment lire un refus

Un refus porte un nom en minuscules avec des tirets — `filter-not-numeric`,
`llm-part-missing`. Certains transportent un détail après deux-points :
`too-large:120000:15` dit combien de lignes et de colonnes ont été vues.

Deux publics, et la distinction compte :

- **visiteur** — le refus est affiché avec son propre message. Il y a un geste
  à faire, et il est décrit ci-dessous.
- **interne** — une invariante du code. Vous ne devriez jamais en croiser un ;
  si cela arrive, c'est un rapport de bug, pas une décision de l'application.

## ML Lab — l'entraînement

| Refus               | Ce qui le déclenche                                              | Quoi faire                                                           |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `no-features`       | Toutes les colonnes ont été exclues, ou aucune n'est utilisable  | Réincluez au moins une colonne dans le panneau des colonnes          |
| `target-not-found`  | La colonne cible n'existe plus dans le fichier                   | Rechoisissez une cible                                               |
| `task-undetectable` | La cible n'est ni numérique continue ni catégorielle exploitable | Choisissez une autre colonne, ou forcez son type dans le Data Studio |
| `too-few-rows`      | Le regroupement sans cible demande plus de lignes qu'il n'y en a | Chargez un fichier plus grand                                        |
| `too-few-points`    | La série temporelle est trop courte pour une prévision honnête   | Étendez la période, ou agrégez moins finement                        |
| `missing-columns`   | Le fichier à scorer n'a pas les colonnes que le modèle attend    | Ajoutez les colonnes nommées dans le message                         |

### Les découpes annoncées

| Refus                        | Ce qui le déclenche                                                               | Quoi faire                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `split-column-not-found`     | La colonne de découpe demandée n'est pas dans le fichier                          | Rechoisissez-la                                                            |
| `split-column-not-dated`     | Une découpe chronologique a été demandée sur une colonne sans dates lisibles      | Prenez une vraie colonne de date, ou revenez à la découpe aléatoire seedée |
| `split-column-not-groupable` | Une découpe par groupe a été demandée sur une colonne qui ne forme pas de groupes | Prenez une colonne à valeurs répétées                                      |

## ML Lab — importer un modèle

Cinq raisons nommées plutôt qu'un « fichier invalide » unique : chacune dit à
quel étage la lecture s'est arrêtée.

| Refus                 | Ce qui le déclenche                                                       | Quoi faire                                              |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `invalid-json`        | Le fichier n'est pas du JSON                                              | Vérifiez que c'est bien le fichier exporté, non modifié |
| `not-labml`           | C'est du JSON, mais pas un export LabML                                   | Exportez le modèle depuis un run LabML                  |
| `unsupported-version` | Format antérieur à la ré-importation                                      | Réexportez le modèle depuis un run récent               |
| `bad-manifest`        | Le manifeste est incomplet — cet export ne peut pas être cru pour prédire | Réexportez ; ne forcez pas                              |
| `unsupported-kind`    | Famille de modèle inconnue dans cet export                                | Réexportez depuis cette version de LabML                |

## Data Studio

| Refus                  | Ce qui le déclenche                                                 | Quoi faire                                                    |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `join-key-missing`     | La clé de jointure n'est pas dans l'un des deux fichiers            | Choisissez une clé présente des deux côtés                    |
| `duckdb-no-worker`     | Le moteur SQL n'a pas pu démarrer                                   | Le reste du Data Studio fonctionne ; rechargez pour réessayer |
| `sql-unsupported-file` | Le fichier déposé dans la console n'est ni CSV, ni Parquet, ni JSON | Convertissez-le dans l'un de ces trois formats                |

## Assistant de données

| Refus                | Ce qui le déclenche                                                   | Quoi faire                                                |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| `filter-not-numeric` | La condition compare une colonne à une valeur qui n'est pas un nombre | Reformulez avec un nombre, ou visez une colonne numérique |
| `unknown-column`     | La question nomme une colonne qui n'existe pas                        | Vérifiez l'orthographe dans le panneau des colonnes       |

L'assistant refuse aussi **sans code**, par un badge : « l'interpréteur
déterministe n'a pas compris » ou « ni l'interpréteur déterministe ni le modèle
local n'ont compris ». C'est le refus le plus fréquent, et le plus important :
il vaut mieux qu'un nombre faux.

## Modèle de langage local

Le modèle est téléchargé en morceaux et recollé dans le navigateur. Quatre
façons distinctes que ça se passe mal, nommées séparément parce qu'elles
n'appellent pas le même geste.

| Refus              | Ce qui le déclenche                                    | Quoi faire                                                                                |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `llm-part-missing` | Un morceau n'a pas été servi                           | Rechargez ; si cela persiste, le déploiement est incomplet                                |
| `llm-part-size`    | Un morceau n'a pas la taille annoncée par le manifeste | Videz le cache du site et rechargez                                                       |
| `llm-short`        | Le fichier recollé est plus court qu'annoncé           | Idem : cache, puis rechargement                                                           |
| `llm-overflow`     | Le fichier recollé est plus long qu'annoncé            | Idem                                                                                      |
| `no-webgpu`        | Le navigateur n'expose pas WebGPU                      | L'interpréteur déterministe reste disponible ; il répond seul à la majorité des questions |

Les trois derniers ne se contentent pas d'échouer : ils refusent **avant**
d'exécuter des octets dont on ne peut pas garantir l'intégrité.

## Vision

La vision refuse sans code d'erreur, par un verdict affiché :

- **aucune classe pour une personne** — les deux détecteurs s'accordent sur une
  personne dans l'image, et ImageNet-1k n'a aucune classe pour un être humain.
  L'étiquette reste visible, mais ce n'est pas une réponse.
- **trop incertain pour nommer** — la première classe est sous le plancher de
  confiance. Les cinq candidates restent listées, à lire comme une liste
  courte.

## Les refus internes

Ceux-ci existent, mais un visiteur ne devrait jamais les voir : ce sont des
invariantes vérifiées pendant l'exécution. Si l'un apparaît, c'est un bug.

`model-not-found`, `no-references`, `no-model`, `no-run`, `no-join`,
`no-data`, `no-manifest`, `not-ready`, `canvas-2d`, `grammar-too-long`,
`grammar-atom-long`, `grammar-option-long`, `grammar-too-many-options`.

## Les garde-fous qui ne sont pas des refus

Deux signaux ressemblent à des refus et n'en sont pas : `not-parallelisable` et
`not-serialisable`. Quand une famille de modèles ne peut pas être entraînée
dans un worker auxiliaire, elle l'est simplement en séquentiel dans le worker
principal. Le résultat est identique, seulement plus lent — c'est pourquoi rien
n'est affiché.
