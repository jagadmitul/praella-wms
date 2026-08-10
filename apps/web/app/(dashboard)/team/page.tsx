import type { Metadata } from 'next';
import { ROLE_LABELS, type Role } from '@wms/contracts';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { getMembers, getSession } from '@/lib/queries';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Team' };

const ROLE_TONE: Record<Role, 'brand' | 'positive' | 'neutral'> = {
  ADMIN: 'brand',
  MANAGER: 'positive',
  STAFF: 'neutral',
};

const ROLE_SUMMARY: Array<{ role: Role; can: string; cannot: string }> = [
  {
    role: 'ADMIN',
    can: 'Everything, including deleting warehouses and managing members.',
    cannot: 'Nothing is withheld.',
  },
  {
    role: 'MANAGER',
    can: 'Run operations: products, stock adjustments, transfers, orders, thresholds.',
    cannot: 'Delete warehouses, change organisation settings, or manage members.',
  },
  {
    role: 'STAFF',
    can: 'View their assigned warehouses and record inbound/outbound movements.',
    cannot: 'Adjust stock, edit the catalogue, or raise orders.',
  },
];

export default async function TeamPage() {
  const [session, members] = await Promise.all([getSession(), getMembers()]);
  const canManage = (session.permissions as string[]).includes('member:manage');

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone collaborating in this organisation. Staff can be scoped to specific warehouses; admins and managers always see every site."
      />

      <Card className="mb-6">
        <CardHeader title="Members" description={`${members.meta.totalItems} people`} />
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Role</Th>
              <Th>Warehouse access</Th>
              <Th>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {members.items.length === 0 ? (
              <EmptyState colSpan={4} title="No members yet" />
            ) : (
              members.items.map((member) => (
                <tr key={member.membershipId}>
                  <Td>
                    <p className="font-medium text-ink-800">
                      {member.fullName}
                      {member.userId === session.user.id ? (
                        <span className="ml-2 text-[11px] font-normal text-ink-400">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-ink-400">{member.email}</p>
                  </Td>
                  <Td>
                    <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABELS[member.role]}</Badge>
                  </Td>
                  <Td>
                    {member.role === 'STAFF' ? (
                      member.warehouses.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {member.warehouses.map((warehouse) => (
                            <Badge key={warehouse.id}>{warehouse.code}</Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-warning-700">
                          No warehouses assigned
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-ink-400">All warehouses</span>
                    )}
                  </Td>
                  <Td className="text-xs text-ink-500">{formatDate(member.joinedAt)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="What each role can do"
          description="Enforced by the API from a single shared permission matrix — this page and the guards read the same source."
        />
        <div className="divide-y divide-line">
          {ROLE_SUMMARY.map((entry) => (
            <div key={entry.role} className="grid gap-2 px-5 py-4 sm:grid-cols-[8rem_1fr]">
              <Badge tone={ROLE_TONE[entry.role]} className="justify-self-start">
                {ROLE_LABELS[entry.role]}
              </Badge>
              <div className="text-sm">
                <p className="text-ink-700">{entry.can}</p>
                <p className="mt-1 text-ink-400">Cannot: {entry.cannot}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {!canManage ? (
        <p className="mt-4 text-xs text-ink-400">
          Only administrators can invite members or change roles.
        </p>
      ) : null}
    </>
  );
}
