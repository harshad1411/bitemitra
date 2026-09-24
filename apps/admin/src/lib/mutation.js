'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from './api';

/**
 * Mutation with consistent feedback: success toast, field errors exposed for forms, other errors toasted
 * with the request id. `invalidate` lists query-key prefixes to refetch.
 */
export function useApiMutation({ mutationFn, invalidate = [], success, onSuccess }) {
  const qc = useQueryClient();
  const [fieldErrors, setFieldErrors] = useState({});
  const mutation = useMutation({
    mutationFn,
    onMutate: () => setFieldErrors({}),
    onSuccess: async (data, vars) => {
      await Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key })));
      if (success) toast.success(typeof success === 'function' ? success(data, vars) : success);
      onSuccess?.(data, vars);
    },
    onError: (err) => {
      if (err?.fieldErrors && Object.keys(err.fieldErrors).length) setFieldErrors(err.fieldErrors);
      toast.error(errorMessage(err), {
        description: err?.requestId ? `Request ID: ${err.requestId}` : undefined,
      });
    },
  });
  return { ...mutation, fieldErrors };
}
