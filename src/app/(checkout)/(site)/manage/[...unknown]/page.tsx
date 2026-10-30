import { notFoundPerRequest } from '@/app/renderPerRequest';

export default async function UnknownPage() {
  await notFoundPerRequest();
}
