export class FakeFrontendDesignReviewAdapter {
    async review(input) {
        const artifact = input?.artifact;
        if (!artifact?.tokens.light.primary || !artifact?.typography.display.family) {
            return { kind: "revise", feedback: "Fill all core token categories before approval." };
        }
        return { kind: "pass" };
    }
}
