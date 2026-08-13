import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DHS To do",
    short_name: "DHS To do",
    description: "DHS To do",
    start_url: "/",
    display: "standalone",
    icons: [
      {
        src: "/logoApp.png",
        sizes: "any",
        type: "image/png",
      },
    ],
  };
}
