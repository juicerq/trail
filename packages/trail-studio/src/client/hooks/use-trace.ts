import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useTrace(eventId: string | null) {
	return useQuery({
		queryKey: ["trace", eventId],
		queryFn: () => api.trace(eventId as string),
		enabled: eventId !== null,
	});
}
