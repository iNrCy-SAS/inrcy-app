export type ImageChannelAssignmentMode = "video" | "images" | "none";

export type ImageChannelAction = Readonly<{
  kind: "selected" | "activate" | "reuse" | "pick";
  label:
    | "Photos"
    | "Utiliser les images existantes ici"
    | "Ajouter des images";
}>;

export function getImageChannelAction(params: {
  hasImagePool: boolean;
  assignedImageCount: number;
  mode: ImageChannelAssignmentMode;
}): ImageChannelAction {
  if (!params.hasImagePool) {
    return { kind: "pick", label: "Ajouter des images" };
  }
  if (params.mode === "images" && params.assignedImageCount > 0) {
    return { kind: "selected", label: "Photos" };
  }
  if (params.assignedImageCount > 0) {
    return {
      kind: "activate",
      label: "Utiliser les images existantes ici",
    };
  }
  return {
    kind: "reuse",
    label: "Utiliser les images existantes ici",
  };
}

function uniqueImageKeys(keys: readonly string[]) {
  return keys
    .filter((key, index, entries) => Boolean(key) && entries.indexOf(key) === index)
    .slice(0, 5);
}

export function moveImageKeyToTarget(
  imageKeys: readonly string[],
  imageKey: string,
  targetImageKey: string,
) {
  const nextKeys = uniqueImageKeys(imageKeys);
  const sourceIndex = nextKeys.indexOf(imageKey);
  const targetIndex = nextKeys.indexOf(targetImageKey);

  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return nextKeys;
  }

  const [movedKey] = nextKeys.splice(sourceIndex, 1);
  if (!movedKey) return nextKeys;
  nextKeys.splice(targetIndex, 0, movedKey);
  return nextKeys;
}

export function applyReferenceImageOrder(
  referenceImageKeys: readonly string[],
  currentImageKeys: readonly string[],
) {
  const referenceKeys = uniqueImageKeys(referenceImageKeys);
  const currentKeys = uniqueImageKeys(currentImageKeys);
  const currentKeySet = new Set(currentKeys);
  const referenceKeySet = new Set(referenceKeys);

  return [
    ...referenceKeys.filter((key) => currentKeySet.has(key)),
    ...currentKeys.filter((key) => !referenceKeySet.has(key)),
  ];
}

export function setImageKeysForChannel<
  TChannel extends string,
  TEditor extends { imageKeys: string[] },
>(
  current: Readonly<Partial<Record<TChannel, TEditor>>>,
  channel: TChannel,
  imageKeys: readonly string[],
  options: {
    fallback: TEditor;
    patch?: Partial<TEditor>;
  },
): Partial<Record<TChannel, TEditor>> {
  const editor = current[channel] || options.fallback;
  return {
    ...current,
    [channel]: {
      ...editor,
      ...options.patch,
      imageKeys: uniqueImageKeys(imageKeys),
    } as TEditor,
  };
}
