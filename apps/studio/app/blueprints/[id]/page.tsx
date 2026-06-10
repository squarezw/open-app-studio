import BlueprintEditor from '../../../components/BlueprintEditor';

export default async function BlueprintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BlueprintEditor id={id} />;
}
