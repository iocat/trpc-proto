export function toPascalCase(name: string): string {
  return name
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export function toScreamingSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '')
    .toUpperCase();
}

export function toCamel(name: string) {
  return name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}
