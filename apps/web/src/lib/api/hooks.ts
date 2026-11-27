"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useInfiniteQuery as useTanStackInfiniteQuery,
  useMutation as useTanStackMutation,
  useQuery as useTanStackQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { executeApiRequest } from "./client";
import type { ApiEndpoint } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = Record<string, any>;

/**
 * Auth state hook backed by Clerk (drop-in replacement for `useApiAuth`).
 */
export function useApiAuth(): { isAuthenticated: boolean; isLoading: boolean } {
  const { isLoaded, isSignedIn } = useAuth();
  return {
    isLoading: !isLoaded,
    isAuthenticated: Boolean(isLoaded && isSignedIn),
  };
}

/**
 * Typed TanStack Query hook bound to Smile's NestJS REST API (`@smile/api`).
 * Pass `"skip"` as args to disable fetching conditionally.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useApiQuery<TResult = any>(
  endpoint: ApiEndpoint<AnyArgs, TResult>,
  args?: AnyArgs | "skip"
): TResult | undefined {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const isSkipped = args === "skip";
  const resolvedArgs = isSkipped ? {} : (args ?? {});
  const authReady = endpoint.isPublic ? true : isLoaded;

  const query = useTanStackQuery<TResult>({
    queryKey: [endpoint.key, resolvedArgs],
    enabled: !isSkipped && authReady,
    staleTime: 15_000,
    queryFn: async () => {
      const token =
        !endpoint.isPublic && isSignedIn ? await getToken() : undefined;
      const raw = await executeApiRequest<TResult>({
        path: endpoint.buildPath(resolvedArgs),
        method: endpoint.method,
        query: endpoint.buildQuery?.(resolvedArgs),
        token,
      });
      return endpoint.transform ? endpoint.transform(raw) : raw;
    },
  });

  return query.data;
}

/**
 * Typed TanStack Mutation hook that automatically invalidates related query
 * prefixes upon success and returns a callable async function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useApiMutation<TResult = any>(
  endpoint: ApiEndpoint<AnyArgs, TResult>
): (args?: AnyArgs) => Promise<TResult> {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const mutation = useTanStackMutation<TResult, Error, AnyArgs>({
    mutationFn: async (args) => {
      const resolvedArgs = args ?? {};
      const token =
        !endpoint.isPublic && isSignedIn ? await getToken() : undefined;
      const raw = await executeApiRequest<TResult>({
        path: endpoint.buildPath(resolvedArgs),
        method: endpoint.method,
        query: endpoint.buildQuery?.(resolvedArgs),
        body: endpoint.buildBody ? endpoint.buildBody(resolvedArgs) : resolvedArgs,
        token,
      });
      return endpoint.transform ? endpoint.transform(raw) : raw;
    },
    onSuccess: async () => {
      if (!endpoint.invalidates?.length) return;
      await Promise.all(
        endpoint.invalidates.map((prefix) =>
          queryClient.invalidateQueries({
            predicate: (q) =>
              typeof q.queryKey[0] === "string" &&
              q.queryKey[0].startsWith(prefix),
          })
        )
      );
    },
  });

  return useCallback(
    (args?: AnyArgs) => mutation.mutateAsync(args ?? {}),
    [mutation]
  );
}

/**
 * Infinite pagination hook backed by TanStack Query `useInfiniteQuery`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useApiPaginatedQuery<TItem = any>(
  endpoint: ApiEndpoint<AnyArgs, { items: TItem[]; total: number; limit: number; offset: number }>,
  args: AnyArgs | "skip",
  options: { initialNumItems: number }
): {
  results: TItem[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  isLoading: boolean;
  loadMore: (numItems: number) => void;
} {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const isSkipped = args === "skip";
  const resolvedArgs = isSkipped ? {} : (args ?? {});
  const pageSize = Math.max(options.initialNumItems || 25, 1);

  const query = useTanStackInfiniteQuery({
    queryKey: [endpoint.key, "paginated", resolvedArgs, pageSize],
    enabled: !isSkipped && (endpoint.isPublic ? true : isLoaded),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const token =
        !endpoint.isPublic && isSignedIn ? await getToken() : undefined;
      const mergedArgs = { ...resolvedArgs, limit: pageSize, offset: pageParam };
      return executeApiRequest<{
        items: TItem[];
        total: number;
        limit: number;
        offset: number;
      }>({
        path: endpoint.buildPath(mergedArgs),
        method: endpoint.method,
        query: endpoint.buildQuery?.(mergedArgs),
        token,
      });
    },
    getNextPageParam: (lastPage) => {
      const nextOffset = (lastPage.offset ?? 0) + (lastPage.items?.length ?? 0);
      return nextOffset < (lastPage.total ?? 0) ? nextOffset : undefined;
    },
  });

  const results = useMemo(
    () => query.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [query.data]
  );

  const status = query.isLoading
    ? "LoadingFirstPage"
    : query.isFetchingNextPage
      ? "LoadingMore"
      : query.hasNextPage
        ? "CanLoadMore"
        : "Exhausted";

  const loadMore = useCallback(
    (_numItems: number) => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    [query]
  );

  return {
    results,
    status,
    isLoading: query.isLoading || query.isFetchingNextPage,
    loadMore,
  };
}
