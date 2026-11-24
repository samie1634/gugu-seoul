/** Use the integrated scene by default, retaining an explicit recovery route. */
export function useIntegratedScene(params: URLSearchParams): boolean {
  return params.get('native') !== 'legacy';
}
