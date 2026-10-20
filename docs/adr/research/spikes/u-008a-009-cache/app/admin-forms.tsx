import { publishNow, publishSwr, publishExpire } from './actions';
export function AdminForms({ tag }: { tag: string }) {
  return (
    <div>
      <form action={publishNow.bind(null, tag)}><button id="update">updateTag {tag}</button></form>
      <form action={publishSwr.bind(null, tag)}><button id="swr">revalidateTag max {tag}</button></form>
      <form action={publishExpire.bind(null, tag)}><button id="expire">revalidateTag expire0 {tag}</button></form>
    </div>
  );
}
