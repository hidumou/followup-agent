import { createContainer } from '../runtime/container.ts';

const container = await createContainer();
export const mastra = container.mastra;
