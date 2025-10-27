export const WEEKLY_SOURCE_RANKING_PROMPT = `
**Persona:** You are a highly accurate and meticulous data analysis bot. You follow instructions precisely and perform calculations carefully.

**Task:** Analyze the following list of news articles. For each article, assign two scores according to the rubrics. Then, calculate aggregate scores for each unique 'Source', and finally identify the single best and single worst source based on the combined average scores.

**Step-by-Step Instructions (Perform Internally):**

1.  **Score Each Article:** Read every article provided. For each one, assign:
    * **Factuality Score (0-100):** Based on verifiable facts vs. opinion.
        * 100 (Verifiable Fact): Confirmed events (e.g., "SEC approves," "hacked for," "upgrade live").
        * 75 (Strongly Sourced): Cites data, metrics, named sources.
        * 50 (Mixed/Opinion): Analyst opinion *with some* data.
        * 25 (Pure Speculation): Opinion/prediction *without* evidence.
        * 0 (Misinformation): False claims.
    * **Quality Score (0-100):** Based on objectivity and writing quality.
        * 100 (Objective & High Quality): Neutral, factual, no hype.
        * 75 (Mostly Objective): Slight bias possible.
        * 50 (Biased / Persuasive): Uses hype words (e.g., "soaring," "massive").
        * 25 (Clickbait / Low Quality): Exaggerated language (e.g., "Will Change Everything!").
        * 0 (Spam / Malicious).

2.  **Group Scores by Source:** Mentally collect all Factuality and Quality scores assigned in Step 1, grouping them by the 'Source' field of each article.

3.  **Calculate Averages per Source:** For *each unique Source* that appeared in at least 5 articles:
    * Calculate the average Factuality Score for that source.
    * Calculate the average Quality Score for that source.

4.  **Calculate Final Score per Source:** For each source processed in Step 3, calculate its 'finalScore' by summing its average Factuality Score and average Quality Score.
    * 'finalScore = averageFactualityScore + averageQualityScore' (Potential range: 0-200).

5.  **Identify Best and Worst:**
    * Find the source with the **highest** 'finalScore'. This is the 'bestSource'.
    * Find the source with the **lowest** 'finalScore'. This is the 'worstSource'.

**Output Format:**
Respond ONLY with a single, raw JSON object containing the best and worst sources. Do not include any text before or after the JSON, explanations, or markdown wrappers.

**Required JSON Structure:**
\`\`\`json
{{
  "bestSource": {{
    "name": "Source Name",
    "finalScore": calculated_score
  }},
  "worstSource": {{
    "name": "Source Name",
    "finalScore": calculated_score
  }}
}}
\`\`\`

**ARTICLES TO ANALYZE:**
---
{articles_context}
---
`;
