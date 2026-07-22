import { Injectable } from '@nestjs/common';
import type { PageQuery } from '@techpioasset/contracts';
import type { AuthUser } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { userScopeFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SORTABLE = ['email', 'createdAt', 'lastLoginAt', 'status'] as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: AuthUser, query: PageQuery) {
    // ANDed, never spread - see AssetsService.list for why.
    const where = {
      AND: [
        userScopeFilter(actor),
        query.q
          ? {
              OR: [
                { email: { contains: query.q, mode: 'insensitive' as const } },
                { profile: { firstName: { contains: query.q, mode: 'insensitive' as const } } },
                { profile: { lastName: { contains: query.q, mode: 'insensitive' as const } } },
                {
                  profile: { employeeNumber: { contains: query.q, mode: 'insensitive' as const } },
                },
              ],
            }
          : {},
      ],
    };

    return paginate(query, {
      count: () => this.prisma.client.user.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.user.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: {
            id: true,
            email: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
            mfaEnabledAt: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                jobTitle: true,
                employeeNumber: true,
                avatarKey: true,
                department: { select: { id: true, name: true } },
                office: { select: { id: true, name: true } },
                manager: { select: { id: true, email: true } },
              },
            },
            roles: { select: { role: { select: { key: true, name: true } } } },
          },
        }),
    });
  }

  /**
   * Reads one user, honouring scope.
   *
   * A record outside the actor's scope returns 404, not 403. Distinguishing the
   * two tells the caller that a record exists at that id, which is the insecure
   * direct object reference the spec's security tests look for.
   */
  async findOne(actor: AuthUser, id: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, ...userScopeFilter(actor) },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerifiedAt: true,
        mfaEnabledAt: true,
        lastLoginAt: true,
        createdAt: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
            jobTitle: true,
            phone: true,
            employeeNumber: true,
            avatarKey: true,
            hireDate: true,
            department: { select: { id: true, name: true } },
            office: { select: { id: true, name: true } },
            manager: { select: { id: true, email: true } },
          },
        },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    });

    if (!user) throw AppError.notFound('User', id);
    return user;
  }
}
