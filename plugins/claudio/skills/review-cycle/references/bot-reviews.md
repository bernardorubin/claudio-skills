# Other AI reviewers on the PR

Loaded by review-cycle steps 2 and 5. Covers any review bot (GitHub Copilot,
CodeRabbit, Sourcery, Greptile, Qodo, Gemini Code Assist, and whatever comes next)
without naming them in advance: the signal is the author's account type, not its
login. A repo with none of them gets nothing from this file, and that is fine.

## 1. Find them

```bash
R={owner}/{repo}; N={pr}

# Inline comments, grouped into threads with their state
gh api graphql -F o={owner} -F r={repo} -F n=$N -f query='
query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
  reviewThreads(first:100){nodes{id isResolved isOutdated path line
    comments(first:20){nodes{databaseId author{login __typename} body createdAt}}}}}}}'

# Review summaries
gh api "repos/$R/pulls/$N/reviews" --paginate \
  --jq '.[] | select(.user.type=="Bot") | {id, login: .user.login, state, commit_id, body}'

# PR-level comments (some bots put their summary here)
gh api "repos/$R/issues/$N/comments" --paginate \
  --jq '.[] | select(.user.type=="Bot") | {id, login: .user.login, created_at, body}'

# Reviews requested but not posted yet
gh pr view $N -R $R --json reviewRequests --jq '.reviewRequests[].login'
```

A bot author is `__typename: "Bot"` in GraphQL and `user.type == "Bot"` in REST.
Keep the threads whose first comment is a bot's and that are not resolved.

## 2. Keep only review input

Plenty of bots comment on PRs without reviewing code. Judge by content, not by name:

- **Drop** deploy, preview, coverage, release and dependency bots: a deploy table,
  a coverage percentage or a changeset reminder is not a finding (vercel, netlify,
  github-actions, codecov, changeset-bot, dependabot, renovate, and the like).
- **Drop** the user's own comments and the `<!-- pr-review -->` living comment.
- **Drop** summary filler with no claim in it: walkthroughs, change tables,
  sequence diagrams. **Keep** the actionable items a summary carries (CodeRabbit's
  "Actionable comments", "Nitpick comments" and "outside diff range" sections).

Nothing left means no AI reviewer on this PR: skip the rest and say so in one line.

## 3. Verify each claim

A bot comment is a claim, usually made against an older commit (`commit_id`). Read
the code at HEAD before acting. An outdated thread often means the code already
moved, so check whether the problem still exists. Each claim ends up as one of:

- **Real**: goes into step 3's triage with the other findings, fix or leave.
- **Already fixed**: by an earlier push in this cycle; note the commit.
- **Wrong**: say why, in one sentence, with the line that proves it.

When a bot and `/pr-review` flag the same thing, keep one finding and credit both.

## 4. Answer on the thread

Write each reply to a temp file, then:

```bash
# Reply in an inline comment's thread
gh api "repos/$R/pulls/$N/comments/{comment_id}/replies" -F body=@reply.md

# Resolve the thread (id from section 1's GraphQL)
gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -F t={thread_id}
```

- **One or two sentences**: "Fixed in `abc1234`: <what changed>", or why it was left
  or why the claim is wrong. No attribution footer: the reply speaks as the user, so
  strip any "Addressed by ..." line a harness adds.
- **Resolve** a thread that is fixed or whose claim was wrong. **Leave open** one that
  is only partly addressed or waits on the user, so the next reader sees it.
- **No separate reply** for a summary-level item with no thread. The living comment
  covers it.
- **Never @mention the bot** unless the user asks. A mention like `@coderabbitai`
  starts another run.

## 5. After a push

Many bots review again on push (CodeRabbit incrementally, Copilot when the repo has
it turned on). Before the final report, rerun section 1 for comments newer than your
last push and triage those too. Don't sit idle waiting for a bot that hasn't posted:
if a review is still requested and pending, say so in the report.
