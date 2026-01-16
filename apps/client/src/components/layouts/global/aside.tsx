import { Box, ScrollArea, Text } from "@mantine/core";
import CommentListWithTabs from "@/features/comment/components/comment-list-with-tabs.tsx";
import { useAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import React, { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TableOfContents } from "@/features/editor/components/table-of-contents/table-of-contents.tsx";
import { AiSidebar } from "@/features/editor/components/ai-sidebar/ai-sidebar.tsx";
import { useAtomValue } from "jotai";
import { pageEditorAtom } from "@/features/editor/atoms/editor-atoms.ts";

export default function Aside() {
  const [{ tab }] = useAtom(asideStateAtom);
  const { t } = useTranslation();
  const pageEditor = useAtomValue(pageEditorAtom);

  let title: string;
  let component: ReactNode;

  switch (tab) {
    case "comments":
      component = <CommentListWithTabs />;
      title = "Comments";
      break;
    case "toc":
      component = <TableOfContents editor={pageEditor} />;
      title = "Table of contents";
      break;
    case "ai":
      component = <AiSidebar editor={pageEditor} />;
      title = "AI Assistant";
      break;
    default:
      component = null;
      title = null;
  }

  return (
    <Box 
      p={tab === "ai" ? 0 : "md"} 
      data-ai-tab={tab === "ai" ? "true" : "false"}
      style={tab === "ai" ? { 
        height: "100%", 
        display: "flex", 
        flexDirection: "column", 
        padding: 0, 
        margin: 0,
        overflow: "hidden"
      } : {}}
    >
      {component && (
        <>
          {tab !== "ai" && (
            <Text mb="md" fw={500}>
              {t(title)}
            </Text>
          )}

          {tab === "comments" ? (
            <CommentListWithTabs />
          ) : tab === "ai" ? (
            <Box style={{ 
              height: "100%", 
              display: "flex", 
              flexDirection: "column", 
              margin: 0, 
              padding: 0,
              overflow: "hidden"
            }}>
              {component}
            </Box>
          ) : (
            <ScrollArea
              style={{ height: "85vh" }}
              scrollbarSize={5}
              type="scroll"
            >
              <div style={{ paddingBottom: "200px" }}>{component}</div>
            </ScrollArea>
          )}
        </>
      )}
    </Box>
  );
}
