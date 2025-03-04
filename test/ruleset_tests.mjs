import {assert} from 'chai';

import {distance} from '../clusters';
import {and, dom, nearest, props, rule, ruleset, score, type} from '../index';
import {domSort, sigmoid, staticDom} from '../utils';


describe('Ruleset', function () {
    describe('get()s', function () {
        it('by arbitrary passed-in LHSs (and scores dom() nodes at 0)', function () {
            const doc = staticDom(`
                <div>Hooooooo</div>
            `);
            const rules = ruleset([
                rule(dom('div'), type('paragraphish'))
            ]);
            const facts = rules.against(doc);
            const div = facts.get(type('paragraphish'))[0];
            assert.equal(div.scoreFor('paragraphish'), sigmoid(0));
        });

        it('by passed-in type(A) LHS, triggering A -> A rules along the way', function () {
            const doc = staticDom(`
                <div>Hooooooo</div>
            `);
            const rules = ruleset([
                rule(dom('div'), type('paragraphish')),
                rule(type('paragraphish'), score(2)),
                rule(type('paragraphish'), type('foo'))
            ]);
            const facts = rules.against(doc);

            // type(A) queries cause A -> A rules to run:
            const div = facts.get(type('paragraphish'))[0];
            assert.equal(div.scoreFor('paragraphish'), sigmoid(2));

            // max() queries do, too:
            const divMax = facts.get(type('paragraphish').max())[0];
            assert.equal(divMax.scoreFor('paragraphish'), sigmoid(2));

            // The and() returns the same fnode as the other queries (which
            // presumably still runs the A -> A rule):
            const divAnd = facts.get(and(type('paragraphish'), type('foo')))[0];
            assert(divAnd === div);
        });

        it('results by out-rule key', function () {
            const doc = staticDom(`
                <div>Hooooooo</div>
            `);
            const rules = ruleset([
                rule(dom('div'), type('paragraphish')),
                rule(type('paragraphish'), 'p')
            ]);
            assert.equal(rules.against(doc).get('p').length, 1);
        });

        it('the fnode corresponding to a passed-in node', function () {
            const doc = staticDom(`
                <div>Hooooooo</div>
            `);
            const rules = ruleset([
                rule(dom('div'), type('paragraphish')),  // when we add .score(1), the test passes.
                rule(type('paragraphish'), score(fnode => fnode.element.textContent.length))
            ]);
            const facts = rules.against(doc);
            const div = facts.get(doc.querySelectorAll('div')[0]);
            // scoreFor() triggers rule execution:
            assert.equal(div.scoreFor('paragraphish'), sigmoid(8));
        });

        it('an empty iterable for nonexistent types', function () {
            // While we're at it, test that querying a nonexistent type from a
            // bound ruleset doesn't crash.
            const rules = ruleset([
                rule(dom('a'), props(n => ({type: 'a'})).typeIn('a', 'b'))
            ]);
            const facts = rules.against(staticDom('<a></a>'));
            // Tempt it to multiply once:
            assert.deepEqual(facts.get(type('b')), []);
        });
    });

    it('assigns scores and notes to nodes', function () {
        // Test the score() and note() calls themselves as well as the ruleset
        // that obeys them.
        const doc = staticDom(`
            <p>
                <a class="good" href="https://github.com/jsdom">Good!</a>
                <a class="bad" href="https://github.com/jsdom">Bad!</a>
            </p>
        `);
        const rules = ruleset([
            rule(dom('a[class=good]'), score(2).type('anchor').note(fnode => 'lovely'))
        ]);
        const anchors = rules.against(doc).get(type('anchor'));
        // Make sure dom() selector actually discriminates:
        assert.equal(anchors.length, 1);
        const anchor = anchors[0];
        assert.equal(anchor.scoreFor('anchor'), sigmoid(2));
        assert.equal(anchor.noteFor('anchor'), 'lovely');
    });

    it("fires rules lazily and doesn't leak scores upstream", function () {
        // Also test that rules fire lazily.
        const doc = staticDom(`
            <p></p>
        `);
        const rules = ruleset([
            rule(dom('p'), type('para').score(2)),
            rule(type('para'), type('smoo').score(3))
        ]);
        const facts = rules.against(doc);

        const para = facts.get(type('para'))[0];
        // Show other-typed scores don't backpropagate to the upstream type:
        assert.equal(para.scoreFor('para'), sigmoid(2));
        // Other rules have had no reason to run yet, so their types' scores
        // remain the default:
        assert.equal(para.scoresSoFarFor('smoo').size, 0);
    });

    describe('runs nearest()', function () {
        it('pairs nearest() nodes', function () {
            // We're pairing each good node with the nearest indifferent one. The
            // bad node exists as a spacer.
            const doc = staticDom(`
                <p>
                    <a class="good" id="good0">Good!</a>
                    <a class="indifferent" id="indifferent0">Indifferent</a>

                    <a class="bad">Bad!</a>

                    <a class="good" id="good1">Good!</a>
                    <a class="indifferent" id="indifferent1">Indifferent</a>
                </p>
            `);
            const rules = ruleset([
                rule(dom('a[class=good]'), type('good')),
                rule(dom('a[class=indifferent]'), type('indifferent')),
                rule(nearest(type('good'), type('indifferent'), distance), type('goodAndIndifferent'))
            ]);
            const goods = domSort(rules.against(doc).get(type('good')));
            assert.equal(goods.length, 2);
            const [good0, good1] = goods;
            assert.equal(good0.element.id, 'good0');
            assert.equal(good1.element.id, 'good1');
            assert.equal(good0.noteFor('goodAndIndifferent').element.id,
                         'indifferent0');
            assert.equal(good1.noteFor('goodAndIndifferent').element.id,
                         'indifferent1');
        });
    });

    describe('complains about rules with missing input', function () {
        it('emitters', function () {
            const doc = staticDom('');
            const rules = ruleset([
                rule(type('c'), type('b'))
            ]);
            const facts = rules.against(doc);
            assert.throws(() => facts.get(type('b')),
                          'No rule emits the "c" type, but another rule needs it as input.');
        });

        it('adders', function () {
            const doc = staticDom('');
            const rules = ruleset([
                rule(type('c'), score(2)),  // emits c but doesn't add it
                rule(type('c'), type('b'))
            ]);
            const facts = rules.against(doc);
            assert.throws(() => facts.get(type('b')),
                          'No rule adds the "c" type, but another rule needs it as input.');
        });
    });

    describe('avoids cycles', function () {
        it('that should be statically detectable, throwing an error', function () {
            const doc = staticDom('<p></p>');
            const rules = ruleset([
                rule(dom('p'), type('a')),
                rule(type('a'), type('b')),
                rule(type('b'), type('a'))
            ]);
            const facts = rules.against(doc);
            assert.throws(() => facts.get(type('a')),
                          'There is a cyclic dependency in the ruleset.');
        });

        // This proves that the order of aggregate rules can't matter, because
        // arrangements where it would matter are illegal due to cycles.
        it('made of aggregates', function () {
            const doc = staticDom('');
            const rules = ruleset([
                rule(dom('p'), type('a')),
                rule(type('a').max(), score(2)),
                rule(type('a').max(), score(.5))
            ]);
            const facts = rules.against(doc);
            assert.throws(() => facts.get(type('a')),
                          'There is a cyclic dependency in the ruleset.');
        });
    });

    describe('plans rule execution', function () {
        it('by demanding rules have determinate type', function () {
            assert.throws(() => ruleset([rule(dom('p'), type('a')),
                                         rule(type('a'), props('dummy'))]),
                          'Could not determine the emitted type of a rule because its right-hand side calls props() without calling typeIn().');
        });

        it('by remembering what types rules add and emit', function () {
            const rule1 = rule(dom('p'), props('dummy').typeIn('q', 'r'));
            const rule2 = rule(type('r'), type('s'));
            const facts = ruleset([rule1, rule2]).against(staticDom(''));
            assert.deepEqual(facts.inwardRulesThatCouldEmit('q'), [rule1]);
            assert.deepEqual(facts.inwardRulesThatCouldAdd('s'), [rule2]);
        });

        it('and avoids unneeded rules', function () {
            const doc = staticDom('<p></p>');
            const rules = ruleset([
                rule(dom('p'), type('a')),
                rule(dom('p'), type('b')),
                rule(type('a'), props(fnode => ({type: 'c'})).typeIn('c')),
                rule(type('b'), props(fnode => ({type: 'd'})).typeIn('d')),
                rule(type('c'), 'c')
            ]);
            const facts = rules.against(doc);
            const p = facts.get('c')[0];
            const typesSoFar = new Set(p.typesSoFar());
            assert(typesSoFar.has('a'));
            assert(!typesSoFar.has('b'));
            assert(typesSoFar.has('c'));
            assert(!typesSoFar.has('d'));
        });
    });

    it('plans for and runs a working and()', function () {
        const doc = staticDom('<a class="smoo"></a><p></p>');
        const rules = ruleset([
            rule(dom('a'), type('A')),
            rule(dom('a[class]'), type('C')),
            rule(dom('a'), type('NEEDLESS')),  // should not be run
            rule(and(type('A'), type('C')), type('BOTH')),
            rule(dom('p'), type('A'))  // A but not C. Tempt and() to grab me.
        ]);
        const facts = rules.against(doc);
        const boths = facts.get(type('BOTH'));
        assert.equal(boths.length, 1);
        assert.deepEqual(Array.from(boths[0].typesSoFar()), ['C', 'A', 'BOTH']);  // no NEEDLESS was run
    });

    it('spits back its rules() verbatim', function () {
        const rules = ruleset([
            rule(dom('a'), type('A')),
            rule(type('A'), type('B')),
            rule(type('A'), 'ay'),
            rule(type('B'), 'be')
        ]);
        const ruleList = rules.rules();
        assert.equal(ruleList.length, 4);  // because deepEqual doesn't actually deep-compare Maps yet
        assert.deepEqual(ruleset(ruleList), rules);
    });

    it('takes a subtree of a document and operates on it', function () {
        const doc = staticDom(`
            <div id=root>some text
             <div id=inner>some more text</div>
            </div>
        `);
        const rules = ruleset([
            rule(dom('#root'), type('smoo').score(10)),
            rule(dom('#inner'), type('smoo').score(5)),
            rule(type('smoo').max(), 'best')
        ]);
        const facts = rules.against(doc);
        const best = facts.get('best');
        assert.equal(best.length, 1);
        assert.equal(best[0].element.id, 'root');

        const subtree = doc.getElementById('root');
        const subtreeFacts = rules.against(subtree);
        const subtreeBest = subtreeFacts.get('best');
        assert.equal(subtreeBest.length, 1);
        assert.equal(subtreeBest[0].element.id, 'inner');
    });

    it('adjusts coeffs and biases after construction', function () {
        const doc = staticDom(`
        `);
        const rules = ruleset([]);
        const facts = rules.against(doc);
        facts.setCoeffsAndBiases([['someRule', 2]],
                                 [['someType', 5]]);
        assert.equal(facts._coeffs.get('someRule'), 2);
        assert.equal(facts.biases.get('someType'), 5);
    });
});


// Maybe there should be a default .score and .note on fnodes that are selected by a type() selector, so we don't have to say scoreFor('someType'), repeating ourselves.
// Decide if * → props(...).score(2) should multiply the score more than once if it just returns the same node over and over. Yes, because it would if you divided it into 2 rules. And if you don't like it, don't return the same element multiple times from props!
