'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { FormField } from '@/components/jamzo/form-field';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { slugify } from '@/lib/format';

function CategoryDialog({ category, onClose }) {
  const [form, setForm] = useState({
    name: category?.name ?? '',
    slug: category?.slug ?? '',
    sortOrder: String(category?.sortOrder ?? 0),
    isActive: category?.isActive ?? true,
  });
  const m = useApiMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        slug: form.slug,
        sortOrder: Number(form.sortOrder),
        isActive: form.isActive,
      };
      return category
        ? api.patch(`/v1/admin/categories/${category.id}`, body)
        : api.post('/v1/admin/categories', body);
    },
    invalidate: [['categories']],
    success: category ? 'Category saved' : 'Category added',
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? `Edit ${category.name}` : 'Add a food category'}</DialogTitle>
          <DialogDescription>
            Platform-wide groups such as Pizza or Thali, used for discovery and, from Phase 4, pricing rules.
          </DialogDescription>
        </DialogHeader>
        <form id="category-form" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <FormField id="c-name" label="Name" errors={m.fieldErrors.name}>
            {(a) => (
              <Input
                {...a}
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    name: e.target.value,
                    ...(category ? {} : { slug: slugify(e.target.value) }),
                  }))
                }
              />
            )}
          </FormField>
          <FormField id="c-slug" label="Slug" errors={m.fieldErrors.slug}>
            {(a) => (
              <Input
                {...a}
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              />
            )}
          </FormField>
          <FormField
            id="c-sort"
            label="Sort order"
            help="Lower numbers come first."
            errors={m.fieldErrors.sortOrder}
          >
            {(a) => (
              <Input
                {...a}
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
              />
            )}
          </FormField>
          <div className="flex items-center gap-2">
            <Switch
              id="c-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
            <Label htmlFor="c-active">Active</Label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" disabled={m.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CategoriesPage() {
  const { can } = useAuth();
  const [dialog, setDialog] = useState(null);
  const q = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/v1/admin/categories') });
  const editable = can('products.manage');
  return (
    <>
      <PageHeader
        title="Food categories"
        description="The platform’s food taxonomy. Each restaurant still has its own menu sections."
        actions={
          editable ? (
            <Button onClick={() => setDialog('new')}>
              <Plus /> Add category
            </Button>
          ) : null
        }
      />
      <Card className="overflow-hidden py-0">
        {q.isPending ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState icon={Tags} title="No food categories yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                  <TableCell className="tabular-nums">{c.productCount}</TableCell>
                  <TableCell>
                    {c.isActive ? (
                      <StatusBadge tone="success">Active</StatusBadge>
                    ) : (
                      <StatusBadge>Hidden</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <Button variant="link" size="sm" onClick={() => setDialog(c)}>
                        Edit
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {dialog ? (
        <CategoryDialog category={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
