/* Pure helpers for GroupShowcase.
   Keep data cleanup, fallback values and visual selection outside React. */

export const GRADIENTS = [
  'linear-gradient(135deg, #9E2188 0%, #5b1370 55%, #2b0a3d 100%)',
  'linear-gradient(135deg, #52A7DD 0%, #2f6fae 55%, #142f57 100%)',
  'linear-gradient(135deg, #b5379b 0%, #7a1d86 50%, #3a1456 100%)',
  'linear-gradient(135deg, #2bb3a3 0%, #1f7aa6 55%, #143a66 100%)',
  'linear-gradient(135deg, #e0608f 0%, #9e2188 55%, #4a1257 100%)',
  'linear-gradient(135deg, #6a5acd 0%, #4b2c8f 55%, #221349 100%)',
  'linear-gradient(135deg, #f0a35e 0%, #c45b7c 55%, #6a1f6f 100%)',
  'linear-gradient(135deg, #3fa7c4 0%, #4a4fbf 55%, #2a1a66 100%)',
];

const DEFAULT_GROUP_NAME = 'קבוצה ללא שם';
const DEFAULT_INITIAL = '◍';

const GROUP_NAME_FIELDS = ['groupName', 'name'];
const IMAGE_URL_FIELDS = ['imageUrl', 'image', 'photoURL'];


function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}


function getFirstNonEmptyString(source, fields) {
  if (!source) {
    return '';
  }

  for (const field of fields) {
    const value = getTrimmedString(source[field]);

    if (value) {
      return value;
    }
  }

  return '';
}


function getRawGroupName(group) {
  return getFirstNonEmptyString(group, GROUP_NAME_FIELDS);
}


export function hashString(value) {
  const text = String(value ?? '');
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}


export function getGroupName(group) {
  return getRawGroupName(group) || DEFAULT_GROUP_NAME;
}


export function getGroupDescription(group) {
  return getTrimmedString(group?.description);
}


export function getInitial(group) {
  return Array.from(getGroupName(group))[0] || DEFAULT_INITIAL;
}


export function getImageUrl(group) {
  return getFirstNonEmptyString(group, IMAGE_URL_FIELDS) || null;
}


export function getGradientSeed(group, index = 0) {
  return (
    getTrimmedString(group?.id) ||
    getRawGroupName(group) ||
    String(index)
  );
}


export function getGroupGradient(group, index = 0) {
  const seed = getGradientSeed(group, index);
  return GRADIENTS[hashString(seed) % GRADIENTS.length];
}


function normalizeIndex(index, count) {
  return ((index % count) + count) % count;
}


export function isNearActiveSlide(index, activeIndex, count) {
  if (count <= 0) {
    return false;
  }

  const normalizedIndex = normalizeIndex(index, count);
  const normalizedActiveIndex = normalizeIndex(activeIndex, count);
  const direct = Math.abs(normalizedIndex - normalizedActiveIndex);
  const wrapped = count - direct;

  return Math.min(direct, wrapped) <= 1;
}
