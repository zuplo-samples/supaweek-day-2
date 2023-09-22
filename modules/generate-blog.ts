import { ZuploContext, ZuploRequest, Logger } from "@zuplo/runtime";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { openai } from "./services/openai";
import { supabase } from "./services/supabase";
import { CompletionCreateParams } from "openai/resources/chat";
import blogSchema from "../schemas/blog.json";

const functions: CompletionCreateParams.Function[] = [
  {
    name: "blogpost",
    description: "A blog post and title",
    parameters: blogSchema,
  },
];

export default async function (request: ZuploRequest, context: ZuploContext) {
  // When using the `api-key-inbound` policy (or any auth policy)
  // Zuplo automatically adds the user's metadata to the request object
  // so we can use it to get the orgId
  const { orgId } = request.user?.data;

  if (!orgId) {
    // This will block the further execution of the request
    // and return a 401 response to the client and it will not hit
    // any other policies or the handler
    return new Response("Unauthorized", { status: 401 });
  }

  const { topic } = await request.json();

  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo-0613",
    stream: true,
    messages: [
      {
        role: "user",
        content: `Give me a 100 words blog about the following topic ${topic}.`,
      },
    ],
    functions,
  });

  const stream = OpenAIStream(response, {
    // this is so we don't block the response from being sent to the client
    // while we save the blog to the database
    onCompletion: async (completion) => {
      await saveBlogToDatabase(completion, orgId, context.log);
    },
  });

  return new StreamingTextResponse(stream);
}

type FunctionResponse = {
  function_call: {
    arguments: string;
    name: string;
  };
};

const saveBlogToDatabase = async (
  blog: string,
  orgId: string,
  logger: Logger
): Promise<"success" | null> => {
  try {
    const functionResponse = JSON.parse(blog) as FunctionResponse;

    const { content, title } = JSON.parse(
      functionResponse.function_call.arguments
    );

    const { error } = await supabase
      .from("blogs")
      .insert({ content, title, orgId });

    if (error) {
      logger.error(error);
      return null;
    }

    return "success";
  } catch (err) {
    logger.error(err);
    return null;
  }
};
