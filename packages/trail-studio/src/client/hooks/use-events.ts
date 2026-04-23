import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useEvents(search: URLSearchParams, paused: boolean) {
	return useQuery({
		queryKey: ["events", search.toString()],
		queryFn: () => api.events(search),
		refetchInterval: paused ? false : 3000,
	});
}
