import { OrgListScreen } from '../../src/components/org-list';

/** Teams people belong to; feeds department-head approvals. */
export default function DepartmentsSettingsScreen() {
  return (
    <OrgListScreen
      title="Departments"
      listPath="/departments/manage"
      writePath="/departments"
      noun="department"
    />
  );
}
