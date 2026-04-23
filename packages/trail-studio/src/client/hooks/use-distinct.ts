import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useDistinct(column: string, enabled: boolean) {
	return useQuery({
		queryKey: ["distinct", column],
		queryFn: () => api.distinct(column),
		enabled,
		staleTime: Infinity,
	});
}
