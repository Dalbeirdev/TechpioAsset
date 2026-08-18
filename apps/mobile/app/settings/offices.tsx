import { OrgListScreen } from '../../src/components/org-list';

/** Sites equipment and people can belong to. */
export default function OfficesSettingsScreen() {
  return (
    <OrgListScreen
      title="Offices"
      listPath="/offices/manage"
      writePath="/offices"
      noun="office"
      extraField={{ key: 'city', label: 'City' }}
    />
  );
}
