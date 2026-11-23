/** Runtime namespace selection only; never authorizes setup, writes or deployment. */
export function mongoRuntimeDatabase(env: NodeJS.ProcessEnv) {
  const scope = env.AFHOMES_MONGODB_SCOPE ?? 'development';
  const configured = env.MONGODB_DB?.trim();
  if (scope === 'development') {
    if (configured !== undefined && configured !== 'afhomes_dev')
      throw new Error('Development runtime requires afhomes_dev');
    return 'afhomes_dev';
  }
  if (
    scope === 'production' &&
    env.NODE_ENV === 'production' &&
    env.AFHOMES_HOSTED_RUNTIME_ENABLED === 'true' &&
    configured === 'afhomes_prod'
  )
    return 'afhomes_prod';
  throw new Error('Production database scope requires explicit hosted production configuration');
}
